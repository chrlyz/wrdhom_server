import fastify from 'fastify';
import { CircuitString, PublicKey, Signature, fetchLastBlock,
  MerkleMap, Field, Poseidon, Mina, PrivateKey, Proof } from 'o1js';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { createFileEncoderStream, CAREncoderStream } from 'ipfs-car';
import { Blob } from '@web-std/file';
import { create } from '@web3-storage/w3up-client';
import { PostState, PostsTransition, Posts, PostsContract, Config } from 'wrdhom';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';

// ============================================================================

// Set up client for PostgreSQL for structured data

const prisma = new PrismaClient();

// Set up client for IPFS for unstructured data

const web3storage = await create();
console.log('Logging-in to web3.storage...');
await web3storage.login('chrlyz@skiff.com');
await web3storage.setCurrentSpace('did:key:z6Mkj6kybvJKUYQNCGvg7vKPayZdn272rPLsVQzF8oDAV8B7');

// Load keys, and set up network and smart contract

const configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const config = configJson.deployAliases['posts'];
const Network = Mina.Network(config.url);
Mina.setActiveInstance(Network);
const fee = Number(config.fee) * 1e9; // in nanomina (1 billion = 1.0 mina)
const feepayerKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(config.feepayerKeyPath, 'utf8'));
const zkAppKeysBase58: { publicKey: string } = JSON.parse(
  await fs.readFile(config.keyPath, 'utf8')
);
const feepayerKey = PrivateKey.fromBase58(feepayerKeysBase58.privateKey);
const feepayerAddress =   PublicKey.fromBase58(feepayerKeysBase58.publicKey);
const zkAppAddress = PublicKey.fromBase58(zkAppKeysBase58.publicKey);
const zkApp = new PostsContract(zkAppAddress);

// Regenerate Merkle maps from database

const posts = await prisma.posts.findMany({
  orderBy: {
    allPostsCounter: 'asc'
  },
  where: {
    postBlockHeight: {
      not: 0
    }
  },
  select: {
    posterAddress: true,
    postContentID: true,
    allPostsCounter: true,
    userPostsCounter: true,
    postBlockHeight: true,
    deletionBlockHeight: true
  }
});
console.log('posts:');
console.log(posts)

const posters = new Set(posts.map( post => post.posterAddress));
console.log('posters:');
console.log(posters);

const usersPostsCountersMap = new MerkleMap();
const postsMap = new MerkleMap();

for (const poster of posters) {
  const userPosts = await prisma.posts.findMany({
    where: { posterAddress: poster,
    postBlockHeight: {
      not: 0
    } },
    select: { userPostsCounter: true }
  });
  console.log(userPosts);
  console.log('Initial usersPostsCountersMap root: ' + usersPostsCountersMap.getRoot().toString());
  usersPostsCountersMap.set(
    Poseidon.hash(PublicKey.fromBase58(poster).toFields()),
    Field(userPosts.length)
  );
  console.log(userPosts.length);
  console.log('Latest usersPostsCountersMap root: ' + usersPostsCountersMap.getRoot().toString());
};

posts.forEach( post => {
  const posterAddress = PublicKey.fromBase58(post.posterAddress);
  const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
  const postContentID = CircuitString.fromString(post.postContentID);
  const postState = new PostState({
    posterAddress: posterAddress,
    postContentID: postContentID,
    allPostsCounter: Field(post.allPostsCounter),
    userPostsCounter: Field(post.userPostsCounter),
    postBlockHeight: Field(post.postBlockHeight),
    deletionBlockHeight: Field(post.deletionBlockHeight),
  });
  console.log('Initial postsMap root: ' + postsMap.getRoot().toString());
  postsMap.set(
    Poseidon.hash([posterAddressAsField, postContentID.hash()]),
    postState.hash()
  );
  console.log('Latest postsMap root: ' + postsMap.getRoot().toString());
});

// Process pending posts to update on-chain state

console.log('Compiling Posts ZkProgram...');
await Posts.compile();
console.log('Compiling PostsContract...');
await PostsContract.compile();
console.log('Compiled');

const pendingPosts = await prisma.posts.findMany({
  take: 5,
  orderBy: {
    allPostsCounter: 'asc'
  },
  where: {
    postBlockHeight: 0
  }
});
console.log('pendingPosts:');
console.log(pendingPosts);

const startTime = performance.now();

const lastBlock = await fetchLastBlock(config.url);
const postBlockHeight = lastBlock.blockchainLength.toBigint() + BigInt(1);
console.log(postBlockHeight);

const transitionsAndProofs: {
  transition: PostsTransition,
  proof: Proof<PostsTransition, void>
}[] = [];

for (const pPost of pendingPosts) {
  console.log('Generating proof...');
  const result = await provePost(Signature.fromBase58(pPost.minaSignature),
  PublicKey.fromBase58(pPost.posterAddress), pPost.allPostsCounter,
  pPost.userPostsCounter, postBlockHeight, pPost.postContentID);
  transitionsAndProofs.push(result);
}

transitionsAndProofs.forEach(t => {
  console.log('initialAllPostsCounter: ' + t.transition.initialAllPostsCounter.toString());
  console.log('latestAllPostsCounter: ' + t.transition.latestAllPostsCounter.toString());
  console.log('initialUsersPostsCounters: ' + t.transition.initialUsersPostsCounters.toString());
  console.log('latestUsersPostsCounters: ' + t.transition.latestUsersPostsCounters.toString());
  console.log('initialPosts: ' + t.transition.initialPosts.toString());
  console.log('latestPosts: ' + t.transition.latestPosts.toString());
  console.log('blockHeight: ' + t.transition.blockHeight.toString());

  console.log('proof.initialAllPostsCounter: ' + t.proof.publicInput.initialAllPostsCounter.toString());
  console.log('proof.latestAllPostsCounter: ' + t.proof.publicInput.latestAllPostsCounter.toString());
  console.log('proof.initialUsersPostsCounters: ' + t.proof.publicInput.initialUsersPostsCounters.toString());
  console.log('proof.latestUsersPostsCounters: ' + t.proof.publicInput.latestUsersPostsCounters.toString());
  console.log('proof.initialPosts: ' + t.proof.publicInput.initialPosts.toString());
  console.log('proof.latestPosts: ' + t.proof.publicInput.latestPosts.toString());
  console.log('proof.blockHeight: ' + t.proof.publicInput.blockHeight.toString());
});

if (transitionsAndProofs.length !== 0) {
  await updateOnChainState(transitionsAndProofs);
}

const endTime = performance.now();

console.log(`${(endTime - startTime)/1000/60} minutes`)

// ============================================================================

// Instantiate Fastify server and set up configurations

const server = fastify();
await server.register(cors, { 
  origin: 'http://localhost:3000',
  methods: ['POST']
});

server.listen({ port: 3001 }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Server listening at ${address}`)
});

server.post<{Body: SignedPost}>('/posts*', async (request, reply) => {

  console.log(request.body.signedData);

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const posterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const postContentIDAsBigInt = Field(request.body.signedData.data[0]).toBigInt();
  const file = new Blob([request.body.post]);
  const postCID = await getCID(file);
  console.log('postCID: ' + postCID);
  const postCIDAsBigInt = CircuitString.fromString(postCID.toString()).hash().toBigInt();

  // Check that content and signed CID match
  const isContentValid = postCIDAsBigInt === postContentIDAsBigInt;
  console.log('Is Content Valid? ' + isContentValid);
  if (isContentValid) {

    const isSigned = signature.verify(
      posterAddress,
      [CircuitString.fromString(postCID.toString()).hash()]
    ).toBoolean();
    console.log('Is Signed? ' + isSigned);
    
    // Check that the signature is valid
    if (isSigned) {

      const allPostsCounter = (await prisma.posts.count()) + 1;
      console.log('allPostsCounter: ' + allPostsCounter);

      const userPostsCID = await prisma.posts.findMany({
        where: {
          posterAddress: posterAddress.toBase58()
        },
        select: {
          postContentID: true
        }
      });
      const userPostsCounter = (userPostsCID.length) + 1;
      console.log('userPostsCounter: ' + userPostsCounter);

      await web3storage.uploadFile(file);
      await createSQLPost(signature, posterAddress, allPostsCounter, userPostsCounter, postCID);
      return request.body;

    } else {
        reply.code(401).send({error: `Post isn't signed`});
    }

  } else {
      reply.code(401).send({error: `Derived post CID, doesn't match signed post CID`});
  }
});

// ============================================================================

interface SignedPost {
  post: string,
  signedData: {
    signature: string,
    publicKey: string,
    data: string[]
  }
}

// ============================================================================

const getCID = async (file: Blob) => {
  let postCID: any;
  await createFileEncoderStream(file)
  .pipeThrough(
  new TransformStream({
      transform(block, controller) {
      postCID = block.cid;
      controller.enqueue(block);
      },
  })
  )
  .pipeThrough(new CAREncoderStream())
  .pipeTo(new WritableStream());

  return postCID;
}

// ============================================================================

const createSQLPost = async (signature: Signature, posterAddress: PublicKey,
  allPostsCounter: number, userPostsCounter: number, postCID: any) => {

  await prisma.posts.create({
    data: {
      posterAddress: posterAddress.toBase58(),
      postContentID: postCID.toString(),
      allPostsCounter: allPostsCounter,
      userPostsCounter: userPostsCounter,
      postBlockHeight: 0,
      deletionBlockHeight: 0,
      minaSignature: signature.toBase58()
    }
  });
}

// ============================================================================

async function provePost(signature: Signature, posterAddress: PublicKey,
  allPostsCounter: bigint, userPostsCounter: bigint,
  postBlockHeight: bigint, postCID: string) {

  const postCIDAsCircuitString = CircuitString.fromString(postCID.toString());

      const postState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(allPostsCounter),
        userPostsCounter: Field(userPostsCounter),
        postBlockHeight: Field(postBlockHeight),
        deletionBlockHeight: Field(0),
      });

      const initialUsersPostsCounters = usersPostsCountersMap.getRoot();
      const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
      const userPostsCounterWitness = 
        usersPostsCountersMap.getWitness(posterAddressAsField);
      usersPostsCountersMap.set(posterAddressAsField, postState.userPostsCounter);
      const latestUsersPostsCounters = usersPostsCountersMap.getRoot();

      const initialPosts = postsMap.getRoot();
      const postKey = Poseidon.hash([posterAddressAsField, postCIDAsCircuitString.hash()]);
      const postWitness = postsMap.getWitness(postKey);
      postsMap.set(postKey, postState.hash());
      const latestPosts = postsMap.getRoot();

      const transition = PostsTransition.createPostPublishingTransition(
        signature,
        postState.allPostsCounter.sub(1),
        initialUsersPostsCounters,
        latestUsersPostsCounters,
        postState.userPostsCounter.sub(1),
        userPostsCounterWitness,
        initialPosts,
        latestPosts,
        postState,
        postWitness
      );
      console.log('Transition created');
      
      const proof = await Posts.provePostPublishingTransition(
        transition,
        signature,
        postState.allPostsCounter.sub(1),
        initialUsersPostsCounters,
        latestUsersPostsCounters,
        postState.userPostsCounter.sub(1),
        userPostsCounterWitness,
        initialPosts,
        latestPosts,
        postState,
        postWitness
      );
      console.log('Proof created');

      return {transition: transition, proof: proof};
}

// ============================================================================

async function updateOnChainState(transitionsAndProofs: {
  transition: PostsTransition,
  proof: Proof<PostsTransition, void>
}[]) {
  let accumulatedMergedTransitions = transitionsAndProofs[0].transition;
  let accumulatedMergedProof = transitionsAndProofs[0].proof;
  for (let i = 0; i < transitionsAndProofs.length - 1; i++) {
    const currentElement = transitionsAndProofs[i+1];

    accumulatedMergedTransitions = PostsTransition.mergePostsTransitions(
      accumulatedMergedTransitions,
      currentElement.transition
    );

    console.log('initialAllPostsCounter: ' + accumulatedMergedTransitions.initialAllPostsCounter.toString());
    console.log('latestAllPostsCounter: ' + accumulatedMergedTransitions.latestAllPostsCounter.toString());
    console.log('initialUsersPostsCounters: ' + accumulatedMergedTransitions.initialUsersPostsCounters.toString());
    console.log('latestUsersPostsCounters: ' + accumulatedMergedTransitions.latestUsersPostsCounters.toString());
    console.log('initialPosts: ' + accumulatedMergedTransitions.initialPosts.toString());
    console.log('latestPosts: ' + accumulatedMergedTransitions.latestPosts.toString());
    console.log('blockHeight: ' + accumulatedMergedTransitions.blockHeight.toString());

    accumulatedMergedProof = await Posts.proveMergedPostsTransitions(
      accumulatedMergedTransitions,
      accumulatedMergedProof,
      currentElement.proof
    );

    console.log('proof.initialAllPostsCounter: ' + accumulatedMergedProof.publicInput.initialAllPostsCounter.toString());
    console.log('proof.latestAllPostsCounter: ' + accumulatedMergedProof.publicInput.latestAllPostsCounter.toString());
    console.log('proof.initialUsersPostsCounters: ' + accumulatedMergedProof.publicInput.initialUsersPostsCounters.toString());
    console.log('proof.latestUsersPostsCounters: ' + accumulatedMergedProof.publicInput.latestUsersPostsCounters.toString());
    console.log('proof.initialPosts: ' + accumulatedMergedProof.publicInput.initialPosts.toString());
    console.log('proof.latestPosts: ' + accumulatedMergedProof.publicInput.latestPosts.toString());
    console.log('proof.blockHeight: ' + accumulatedMergedProof.publicInput.blockHeight.toString());
  }
  
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    () => {
      zkApp.update(accumulatedMergedProof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn?.hash() !== undefined) {
    console.log(`https://berkeley.minaexplorer.com/transaction/${sentTxn.hash()}`);
  }
}