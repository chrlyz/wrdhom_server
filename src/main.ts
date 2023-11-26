import fastify from 'fastify';
import { CircuitString, PublicKey, Signature, fetchLastBlock,
  MerkleMap, Field, Poseidon, Mina, PrivateKey } from 'o1js';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { createFileEncoderStream, CAREncoderStream } from 'ipfs-car';
import { Blob } from '@web-std/file';
import { create } from '@web3-storage/w3up-client';
import { PostState, PostsTransition, Posts, PostsContract, Config } from 'wrdhom';
import fs from 'fs/promises';

// ============================================================================

const server = fastify();
await server.register(cors, { 
  origin: 'http://localhost:3000',
  methods: ['POST']
});

const prisma = new PrismaClient();

const web3storage = await create();
console.log('Logging-in to web3.storage...');
await web3storage.login('chrlyz@skiff.com');
await web3storage.setCurrentSpace('did:key:z6Mkj6kybvJKUYQNCGvg7vKPayZdn272rPLsVQzF8oDAV8B7');

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

const usersPostsCountersMap = new MerkleMap();
const postsMap = new MerkleMap();


console.log('Compiling Posts ZkProgram...');
await Posts.compile();
console.log('Compiling PostsContract...');
await PostsContract.compile();
console.log('Compiled');

// ============================================================================

server.post<{Body: SignedPost}>('/posts*', async (request, reply) => {

  console.log(request.body.signedData);

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const posterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const postContentIDAsBigInt = Field(request.body.signedData.data[0]).toBigInt();

  const file = new Blob([request.body.post]);
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

  const postCIDAsBigInt = CircuitString.fromString(postCID.toString()).hash().toBigInt();

  // Check that content and signed CID match
  if (postCIDAsBigInt === postContentIDAsBigInt) {

    const isSigned = signature.verify(
      posterAddress,
      [CircuitString.fromString(postCID.toString()).hash()]
    ).toBoolean();
    console.log(isSigned);
    
    // Check that the signature is valid
    if (isSigned) {

      const allPostsCounter = Field(await prisma.posts.count());
      console.log('allPostsCounter: ' + allPostsCounter.toBigInt());
      const userPostsCID = await prisma.posts.findMany({
        where: {
          posterAddress: posterAddress.toBase58()
        },
        select: {
          postContentID: true
        }
      });
      const userPostsCounter = Field(userPostsCID.length);
      console.log('userPostsCounter: ' + userPostsCounter.toBigInt());

      const lastBlock = await fetchLastBlock(config.url);
      const postBlockHeight = Field(lastBlock.blockchainLength.toString());

      const postCIDAsCircuitString = CircuitString.fromString(postCID.toString());

      const postState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: allPostsCounter.add(1),
        userPostsCounter: userPostsCounter.add(1),
        postBlockHeight: postBlockHeight,
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

      try {
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
      console.log('transition');
      
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
      console.log('proof');

      let sentTxn;
      try {
        const txn = await Mina.transaction(
          { sender: feepayerAddress, fee: fee },
          () => {
            zkApp.update(proof);
          }
        );
        await txn.prove();
        sentTxn = await txn.sign([feepayerKey]).send();
      } catch (err) {
        console.log(err);
      }
      if (sentTxn?.hash() !== undefined) {
        console.log(`https://berkeley.minaexplorer.com/transaction/${sentTxn.hash()}`);
      }
      } catch (e) {
        console.log(e);
      }

      const uploadedFile = await web3storage.uploadFile(file);
      await createSQLPost(postState, signature);
      return request.body;
    } else {
        reply.code(401).send({error: `Post isn't signed`});
    }
  } else {
      reply.code(401).send({error: `Derived post CID, doesn't match signed post CID`});
  }
});

server.listen({ port: 3001 }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Server listening at ${address}`)
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

const createSQLPost = async (postState: PostState, signature: Signature) => {

  await prisma.posts.create({
    data: {
      posterAddress: postState.posterAddress.toBase58(),
      postContentID: postState.postContentID.toString(),
      allPostsCounter: postState.allPostsCounter.toBigInt(),
      userPostsCounter: postState.userPostsCounter.toBigInt(),
      deletionBlockHeight: 0,
      minaSignature: signature.toBase58()
    }
  });
}