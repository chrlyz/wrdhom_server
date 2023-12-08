import { CircuitString, PublicKey, Signature, fetchLastBlock,
  MerkleMap, Field, Poseidon, Mina, PrivateKey,
  fetchAccount, Cache } from 'o1js';
import { PostState, PostsTransition, Posts,
  PostsContract, Config, PostsProof } from 'wrdhom';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ============================================================================

// Set up client for PostgreSQL for structured data

const prisma = new PrismaClient();

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
// Fetch accounts to make sure they are available on cache during the execution of the program
await fetchAccount({ publicKey: zkAppKeysBase58.publicKey });
await fetchAccount({ publicKey: feepayerKeysBase58.publicKey });
const zkApp = new PostsContract(zkAppAddress);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cachePath = join(__dirname, '..', '/cache/');
const jobPath = join(__dirname, 'proverJob.js');

let startTime = performance.now();
console.log('Compiling Posts ZkProgram...');
await Posts.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling PostsContract...');
await PostsContract.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiled');
let endTime = performance.now();
console.log(`${(endTime - startTime)/1000/60} minutes`);

// Regenerate Merkle maps from database

let usersPostsCountersMap = new MerkleMap();
let postsMap = new MerkleMap();

const posts = await prisma.posts.findMany({
  orderBy: {
    allPostsCounter: 'asc'
  },
  where: {
    postBlockHeight: {
      not: 0
    }
  }
});
console.log('posts:');
console.log(posts)

const posters = new Set(posts.map( post => post.posterAddress));
console.log('posters:');
console.log(posters);

for (const poster of posters) {
const userPosts = await prisma.posts.findMany({
  where: { posterAddress: poster,
  postBlockHeight: {
  not: 0
  } },
  select: {
    userPostsCounter: true
  }
});
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
    restorationBlockHeight: Field(post.restorationBlockHeight)
  });
  console.log('Initial postsMap root: ' + postsMap.getRoot().toString());
  postsMap.set(
    Poseidon.hash([posterAddressAsField, postContentID.hash()]),
    postState.hash()
  );
  console.log('Latest postsMap root: ' + postsMap.getRoot().toString());
});

let numberOfPosts = posts.length;
console.log('Original number of posts: ' + numberOfPosts);

while (true) {
  // Process pending posts to update on-chain state

  const pendingPosts = await prisma.posts.findMany({
  take: 2,
  orderBy: {
      allPostsCounter: 'asc'
  },
  where: {
      postBlockHeight: 0
  }
  });
  numberOfPosts += pendingPosts.length;
  console.log('Number of posts if update is successful: ' + numberOfPosts);
  console.log('pendingPosts:');
  console.log(pendingPosts);

  startTime = performance.now();

  const connection = {
    host: '127.0.0.1',
    port: 6379
  }

  const postsQueue = new Queue('posts', {connection});
  const queueEvents = new QueueEvents('posts', {connection});

  const lastBlock = await fetchLastBlock(config.url);
  const postBlockHeight = lastBlock.blockchainLength.toBigint();
  console.log(postBlockHeight);

  const provePostInputs: {
    signature: string,
    transition: string,
    postState: string,
    userPostsCounterWitness: string,
    postWitness: string,
    cachePath: string
  }[] = [];

  for (const pPost of pendingPosts) {
    const signature = Signature.fromBase58(pPost.minaSignature);
    const postCIDAsCircuitString = CircuitString.fromString(pPost.postContentID.toString());
  
    const postState = new PostState({
      posterAddress: PublicKey.fromBase58(pPost.posterAddress),
      postContentID: postCIDAsCircuitString,
      allPostsCounter: Field(pPost.allPostsCounter),
      userPostsCounter: Field(pPost.userPostsCounter),
      postBlockHeight: Field(postBlockHeight),
      deletionBlockHeight: Field(pPost.deletionBlockHeight),
      restorationBlockHeight: Field(pPost.restorationBlockHeight)
    });

    const initialUsersPostsCounters = usersPostsCountersMap.getRoot();
    const posterAddressAsField = Poseidon.hash(postState.posterAddress.toFields());
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

    provePostInputs.push({
      signature: pPost.minaSignature,
      transition: JSON.stringify(transition),
      postState: JSON.stringify(postState),
      userPostsCounterWitness: JSON.stringify(userPostsCounterWitness.toJSON()),
      postWitness: JSON.stringify(postWitness.toJSON()),
      cachePath: cachePath
    });
  }

  const jobsPromises: Promise<any>[] = [];

  for (const provePostInput of provePostInputs) {
    const job = await postsQueue.add(
      `job`,
      { provePostInput: provePostInput }
    );
    jobsPromises.push(job.waitUntilFinished(queueEvents));

    const worker = new Worker('posts', jobPath , {connection, concurrency: 1});
  }

  const transitionsAndProofsS: {
    transition: string;
    proof: string;
  }[] = await Promise.all(jobsPromises);

  const transitionsAndProofs: {
    transition: PostsTransition,
    proof: PostsProof
  }[] = [];

  transitionsAndProofsS.forEach(transitionAndProofS => {
    transitionsAndProofs.push({
      transition: PostsTransition.fromJSON(JSON.parse(transitionAndProofS.transition)),
      proof: PostsProof.fromJSON(JSON.parse(transitionAndProofS.proof))
    });
  });

  if (transitionsAndProofs.length !== 0) {
    await updateOnChainState(transitionsAndProofs);

    endTime = performance.now();
    console.log(`${(endTime - startTime)/1000/60} minutes`);

    let tries = 0;
    const maxTries = 15;
    let allPostsCounterFetch;
    let usersPostsCountersFetch;
    let postsFetch;
    while (tries < maxTries) {
      console.log('Pause to wait for the transaction to confirm...');
      await delay(60000);

      allPostsCounterFetch = await zkApp.allPostsCounter.fetch();
      console.log('allPostsCounterFetch: ' + allPostsCounterFetch?.toString());
      usersPostsCountersFetch = await zkApp.usersPostsCounters.fetch();
      console.log('usersPostsCountersFetch: ' + usersPostsCountersFetch?.toString());
      postsFetch = await zkApp.posts.fetch();
      console.log('postsFetch: ' + postsFetch?.toString());

      console.log(Field(numberOfPosts).toString());
      console.log(usersPostsCountersMap.getRoot().toString());
      console.log(postsMap.getRoot().toString());

      console.log(allPostsCounterFetch?.equals(Field(numberOfPosts)).toBoolean());
      console.log(usersPostsCountersFetch?.equals(usersPostsCountersMap.getRoot()).toBoolean());
      console.log(postsFetch?.equals(postsMap.getRoot()).toBoolean());

      if (allPostsCounterFetch?.equals(Field(numberOfPosts)).toBoolean()
      && usersPostsCountersFetch?.equals(usersPostsCountersMap.getRoot()).toBoolean()
      && postsFetch?.equals(postsMap.getRoot()).toBoolean()) {
        for (const pPost of pendingPosts) {
          await prisma.posts.update({
              where: {
                posterAddress_postContentID: {
                    posterAddress: pPost.posterAddress,
                    postContentID: pPost.postContentID
                }
              },
              data: {
                postBlockHeight: postBlockHeight
              }
          });
        }
        tries = maxTries;
      }
      // Reset initial state if transaction appears to have failed
      if (tries === maxTries - 1) {
        numberOfPosts -= pendingPosts.length;
        console.log('Original number of posts: ' + numberOfPosts);

        const pendingPosters = new Set(pendingPosts.map( post => post.posterAddress));
        for (const poster of pendingPosters) {
          const userPosts = await prisma.posts.findMany({
            where: { posterAddress: poster,
              postBlockHeight: {
                not: 0
              }
            },
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

          pendingPosts.forEach( pPost => {
            const posterAddress = PublicKey.fromBase58(pPost.posterAddress);
            const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
            const postContentID = CircuitString.fromString(pPost.postContentID);
            console.log('Initial postsMap root: ' + postsMap.getRoot().toString());
            postsMap.set(
                Poseidon.hash([posterAddressAsField, postContentID.hash()]),
                Field(0)
            );
            console.log('Latest postsMap root: ' + postsMap.getRoot().toString());
          });
        };
      }
      tries++;
    }
  } else {
    console.log('Pause to wait for new posts before running loop again...');
    await delay(60000);
  }
}
  
// ============================================================================
  
  async function updateOnChainState(transitionsAndProofs: {
    transition: PostsTransition,
    proof: PostsProof
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
      console.log(`https://minascan.io/berkeley/tx/${sentTxn.hash()}`);
    }

    return sentTxn;
  }

// ============================================================================

  async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}