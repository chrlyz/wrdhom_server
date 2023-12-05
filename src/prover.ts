import { CircuitString, PublicKey, Signature, fetchLastBlock,
  MerkleMap, Field, Poseidon, Mina, PrivateKey, Proof,
  fetchAccount } from 'o1js';
import { PostState, PostsTransition, Posts,
  PostsContract, Config } from 'wrdhom';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';
import { PrismaClient } from '@prisma/client';

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

console.log('Compiling Posts ZkProgram...');
await Posts.compile();
console.log('Compiling PostsContract...');
await PostsContract.compile();
console.log('Compiled');

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

  const startTime = performance.now();

  const lastBlock = await fetchLastBlock(config.url);
  const postBlockHeight = lastBlock.blockchainLength.toBigint();
  console.log(postBlockHeight);

  const transitionsAndProofs: {
    transition: PostsTransition,
    proof: Proof<PostsTransition, void>
  }[] = [];

  for (const pPost of pendingPosts) {
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
    const sentTxn = await updateOnChainState(transitionsAndProofs);

    const endTime = performance.now();
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
      console.log(`https://minascan.io/berkeley/tx/${sentTxn.hash()}`);
    }

    return sentTxn;
  }

// ============================================================================

  async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}