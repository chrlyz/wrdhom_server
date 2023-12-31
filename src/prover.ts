import { CircuitString, PublicKey, Signature, fetchLastBlock,
  MerkleMap, Field, Poseidon, Mina, PrivateKey,
  fetchAccount, Cache, Bool } from 'o1js';
import { Config, PostState, PostsTransition, Posts,
  PostsContract, PostsProof, ReactionState,
  ReactionsTransition, Reactions, ReactionsContract,
  ReactionsProof } from 'wrdhom';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { regeneratePostsZkAppState, regenerateReactionsZkAppState } from './utils/state.js';

// ============================================================================

// Set up client for PostgreSQL for structured data

const prisma = new PrismaClient();

// Load keys, and set up network and smart contract

const configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const configPosts = configJson.deployAliases['posts'];
const configReactions = configJson.deployAliases['reactions'];
const Network = Mina.Network(configPosts.url);
Mina.setActiveInstance(Network);
const fee = Number(configPosts.fee) * 1e9; // in nanomina (1 billion = 1.0 mina)
const feepayerKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(configPosts.feepayerKeyPath, 'utf8'));
const postsContractKeysBase58: { publicKey: string } =
  JSON.parse(await fs.readFile(configPosts.keyPath, 'utf8'));
const reactionsContractKeysBase58: { publicKey: string } =
  JSON.parse(await fs.readFile(configReactions.keyPath, 'utf8'));
const feepayerKey = PrivateKey.fromBase58(feepayerKeysBase58.privateKey);
const feepayerAddress =   PublicKey.fromBase58(feepayerKeysBase58.publicKey);
const postsContractAddress = PublicKey.fromBase58(postsContractKeysBase58.publicKey);
const reactionsContractAddress = PublicKey.fromBase58(reactionsContractKeysBase58.publicKey);
// Fetch accounts to make sure they are available on cache during the execution of the program
await fetchAccount({ publicKey: feepayerKeysBase58.publicKey });
await fetchAccount({ publicKey: postsContractKeysBase58.publicKey });
await fetchAccount({ publicKey: reactionsContractKeysBase58.publicKey });
const postsContract = new PostsContract(postsContractAddress);
const reactionsContract = new ReactionsContract(reactionsContractAddress);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cachePath = join(__dirname, '..', '/cache/');

let startTime = performance.now();
console.log('Compiling Posts ZkProgram...');
await Posts.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling PostsContract...');
await PostsContract.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling Reactions ZkProgram...');
await Reactions.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling ReactionsContract...');
await ReactionsContract.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiled');
let endTime = performance.now();
console.log(`${(endTime - startTime)/1000/60} minutes`);

// Regenerate Merkle maps from database

const usersPostsCountersMap = new MerkleMap();
const postsMap = new MerkleMap();
let numberOfPosts = 0;

const postsContext = {
  prisma: prisma,
  usersPostsCountersMap: usersPostsCountersMap,
  postsMap: postsMap,
  numberOfPosts: numberOfPosts
}

await regeneratePostsZkAppState(postsContext);

const usersReactionsCountersMap = new MerkleMap();
const targetsReactionsCountersMap =  new MerkleMap();
const reactionsMap = new MerkleMap();
let numberOfRections = 0;

const reactionsContext = {
  prisma: prisma,
  usersReactionsCountersMap: usersReactionsCountersMap,
  targetsReactionsCountersMap: targetsReactionsCountersMap,
  reactionsMap: reactionsMap,
  numberOfRections: numberOfRections
}

await regenerateReactionsZkAppState(reactionsContext);

const provingPosts = 0;
const provingReactions = 1;
let provingTurn = 0;

while (true) {
  if (provingTurn === provingPosts) {
      // Process pending posts to update on-chain state

  const pendingPosts = await prisma.posts.findMany({
    take: 1,
    orderBy: {
        allPostsCounter: 'asc'
    },
    where: {
        postBlockHeight: 0
    }
    });
    postsContext.numberOfPosts += pendingPosts.length;
    console.log('Number of posts if update is successful: ' + postsContext.numberOfPosts);
    console.log('pendingPosts:');
    console.log(pendingPosts);
  
    startTime = performance.now();
  
    const lastBlock = await fetchLastBlock(configPosts.url);
    const postBlockHeight = lastBlock.blockchainLength.toBigint();
    console.log(postBlockHeight);
  
    const transitionsAndProofs: {
      transition: PostsTransition,
      proof: PostsProof
    }[] = [];
  
    for (const pPost of pendingPosts) {
      const result = await provePost(
        pPost.postSignature,
        pPost.posterAddress,
        pPost.postContentID,
        pPost.allPostsCounter,
        pPost.userPostsCounter,
        postBlockHeight,
        pPost.deletionBlockHeight,
        pPost.restorationBlockHeight
      );
  
      transitionsAndProofs.push(result);
    }
  
    if (transitionsAndProofs.length !== 0) {
      await updatePostsOnChainState(transitionsAndProofs);
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);
  
      let tries = 0;
      const maxTries = 50;
      let allPostsCounterFetch;
      let usersPostsCountersFetch;
      let postsFetch;
      while (tries < maxTries) {
        console.log('Pause to wait for the transaction to confirm...');
        await delay(20000);
  
        allPostsCounterFetch = await postsContract.allPostsCounter.fetch();
        console.log('allPostsCounterFetch: ' + allPostsCounterFetch?.toString());
        usersPostsCountersFetch = await postsContract.usersPostsCounters.fetch();
        console.log('usersPostsCountersFetch: ' + usersPostsCountersFetch?.toString());
        postsFetch = await postsContract.posts.fetch();
        console.log('postsFetch: ' + postsFetch?.toString());
  
        console.log(Field(postsContext.numberOfPosts).toString());
        console.log(usersPostsCountersMap.getRoot().toString());
        console.log(postsMap.getRoot().toString());
  
        console.log(allPostsCounterFetch?.equals(Field(postsContext.numberOfPosts)).toBoolean());
        console.log(usersPostsCountersFetch?.equals(usersPostsCountersMap.getRoot()).toBoolean());
        console.log(postsFetch?.equals(postsMap.getRoot()).toBoolean());
  
        if (allPostsCounterFetch?.equals(Field(postsContext.numberOfPosts)).toBoolean()
        && usersPostsCountersFetch?.equals(usersPostsCountersMap.getRoot()).toBoolean()
        && postsFetch?.equals(postsMap.getRoot()).toBoolean()) {
          for (const pPost of pendingPosts) {
            const posterAddress = PublicKey.fromBase58(pPost.posterAddress);
            const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
            const postContentID = CircuitString.fromString(pPost.postContentID);
            const postContentIDAsField = postContentID.hash();
            const postKey = Poseidon.hash([posterAddressAsField, postContentIDAsField]);
            await prisma.posts.update({
                where: {
                  postKey: postKey.toString()
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
          postsContext.numberOfPosts -= pendingPosts.length;
          console.log('Original number of posts: ' + postsContext.numberOfPosts);
  
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
          };

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
        }
        tries++;
      }
    }

  } else if (provingTurn === provingReactions) {

    const pendingReactions = await prisma.reactions.findMany({
      take: 1,
      orderBy: {
          allReactionsCounter: 'asc'
      },
      where: {
          reactionBlockHeight: 0
      }
      });
      reactionsContext.numberOfRections += pendingReactions.length;
      console.log('Number of reactions if update is successful: ' + reactionsContext.numberOfRections);
      console.log('pendingReactions:');
      console.log(pendingReactions);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configPosts.url);
      const reactionBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(reactionBlockHeight);
    
      const transitionsAndProofs: {
        transition: ReactionsTransition,
        proof: ReactionsProof
      }[] = [];
    
      for (const pReaction of pendingReactions) {
        const result = await proveReaction(
          pReaction.isTargetPost,
          pReaction.targetKey,
          pReaction.reactorAddress,
          pReaction.reactionCodePoint,
          pReaction.allReactionsCounter,
          pReaction.userReactionsCounter,
          pReaction.targetReactionsCounter,
          reactionBlockHeight,
          pReaction.deletionBlockHeight,
          pReaction.restorationBlockHeight,
          pReaction.reactionSignature
        );
    
        transitionsAndProofs.push(result);
      }
    
      if (transitionsAndProofs.length !== 0) {
        await updateReactionsOnChainState(transitionsAndProofs);
    
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allReactionsCounterFetch;
        let userReactionsCounterFetch;
        let targetReactionsCounterFetch;
        let reactionsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allReactionsCounterFetch = await reactionsContract.allReactionsCounter.fetch();
          console.log('allReactionsCounterFetch: ' + allReactionsCounterFetch?.toString());
          userReactionsCounterFetch = await reactionsContract.usersReactionsCounters.fetch();
          console.log('userReactionsCounterFetch: ' + userReactionsCounterFetch?.toString());
          targetReactionsCounterFetch = await reactionsContract.targetsReactionsCounters.fetch();
          console.log('targetReactionsCounterFetch: ' + targetReactionsCounterFetch?.toString());
          reactionsFetch = await reactionsContract.reactions.fetch();
          console.log('reactionsFetch: ' + reactionsFetch?.toString());
    
          console.log(Field(reactionsContext.numberOfRections).toString());
          console.log(usersReactionsCountersMap.getRoot().toString());
          console.log(targetsReactionsCountersMap.getRoot().toString());
          console.log(reactionsMap.getRoot().toString());
    
          console.log(allReactionsCounterFetch?.equals(Field(reactionsContext.numberOfRections)).toBoolean());
          console.log(userReactionsCounterFetch?.equals(usersReactionsCountersMap.getRoot()).toBoolean());
          console.log(targetReactionsCounterFetch?.equals(targetsReactionsCountersMap.getRoot()).toBoolean());
          console.log(reactionsFetch?.equals(reactionsMap.getRoot()).toBoolean());
    
          if (allReactionsCounterFetch?.equals(Field(reactionsContext.numberOfRections)).toBoolean()
          && userReactionsCounterFetch?.equals(usersReactionsCountersMap.getRoot()).toBoolean()
          && targetReactionsCounterFetch?.equals(targetsReactionsCountersMap.getRoot()).toBoolean()
          && reactionsFetch?.equals(reactionsMap.getRoot()).toBoolean()) {
            for (const pReaction of pendingReactions) {
              await prisma.reactions.update({
                  where: {
                    reactionKey: pReaction.reactionKey
                  },
                  data: {
                    reactionBlockHeight: reactionBlockHeight
                  }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {
            reactionsContext.numberOfRections -= pendingReactions.length;
            console.log('Original number of reactions: ' + postsContext.numberOfPosts);
    
            const pendingReactors = new Set(pendingReactions.map( reaction => reaction.reactorAddress));
            for (const reactor of pendingReactors) {
              const userReactions = await prisma.reactions.findMany({
                where: {
                  reactorAddress: reactor,
                  reactionBlockHeight: {
                    not: 0
                  }
                }
              });
              console.log(userReactions);
              console.log('Initial usersReactionsCountersMap root: ' + usersReactionsCountersMap.getRoot().toString());
              usersReactionsCountersMap.set(
                Poseidon.hash(PublicKey.fromBase58(reactor).toFields()),
                Field(userReactions.length)
              );
              console.log(userReactions.length);
              console.log('Latest usersReactionsCountersMap root: ' + usersReactionsCountersMap.getRoot().toString());
            };

            const pendingTargets = new Set(pendingReactions.map( reaction => reaction.targetKey));
            for (const target of pendingTargets) {
              const targetReactions = await prisma.reactions.findMany({
                where: {
                  targetKey: target,
                  reactionBlockHeight: {
                    not: 0
                  }
                }
              })
              console.log('Initial targetsReactionsCountersMap root: ' + targetsReactionsCountersMap.getRoot().toString());
              targetsReactionsCountersMap.set(
                Field(target),
                Field(targetReactions.length)
              );
              console.log(targetReactions.length);
              console.log('Latest targetsReactionsCountersMap root: ' + targetsReactionsCountersMap.getRoot().toString());
            }

            pendingReactions.forEach( pReaction => {
              console.log('Initial reactionsMap root: ' + reactionsMap.getRoot().toString());
              reactionsMap.set(
                  Field(pReaction.reactionKey),
                  Field(0)
              );
              console.log('Latest reactionsMap root: ' + reactionsMap.getRoot().toString());
            });
          }
          tries++;
        }
      } else {
        console.log('Pause to wait for new actions before running loop again...');
        await delay(10000);
      }
  }
  provingTurn++;
  if (provingTurn > provingReactions) {
    provingTurn = 0;
  }
}

// ============================================================================

async function provePost(signatureBase58: string, posterAddressBase58: string,
  postCID: string, allPostsCounter: bigint, userPostsCounter: bigint,
  postBlockHeight: bigint, deletionBlockHeight: bigint, restorationBlockHeight: bigint) {

  const signature = Signature.fromBase58(signatureBase58);
  const posterAddress = PublicKey.fromBase58(posterAddressBase58);
  const postCIDAsCircuitString = CircuitString.fromString(postCID.toString());

      const postState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(allPostsCounter),
        userPostsCounter: Field(userPostsCounter),
        postBlockHeight: Field(postBlockHeight),
        deletionBlockHeight: Field(deletionBlockHeight),
        restorationBlockHeight: Field(restorationBlockHeight)
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
  
  async function updatePostsOnChainState(transitionsAndProofs: {
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
        postsContract.update(accumulatedMergedProof);
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

async function proveReaction(isTargetPost: boolean, targetKey: string,
  reactorAddressBase58: string, reactionCodePoint: bigint,
  allReactionsCounter: bigint, userReactionsCounter: bigint,
  targetReactionsCounter: bigint, reactionBlockHeight: bigint,
  deletionBlockHeight: bigint, restorationBlockHeight: bigint,
  signatureBase58: string) {

  const reactorAddress = PublicKey.fromBase58(reactorAddressBase58);
  const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
  const reactionCodePointAsField = Field(reactionCodePoint);
  const targetKeyAsField = Field(targetKey);
  const signature = Signature.fromBase58(signatureBase58);

  const reactionState = new ReactionState({
    isTargetPost: Bool(isTargetPost),
    targetKey: targetKeyAsField,
    reactorAddress: reactorAddress,
    reactionCodePoint: reactionCodePointAsField,
    allReactionsCounter: Field(allReactionsCounter),
    userReactionsCounter: Field(userReactionsCounter),
    targetReactionsCounter: Field(targetReactionsCounter),
    reactionBlockHeight: Field(reactionBlockHeight),
    deletionBlockHeight: Field(deletionBlockHeight),
    restorationBlockHeight: Field(restorationBlockHeight)
  });

  const initialUsersReactionsCounters = usersReactionsCountersMap.getRoot();
  const userReactionsCounterWitness = usersReactionsCountersMap.getWitness(reactorAddressAsField);
  usersReactionsCountersMap.set(reactorAddressAsField, reactionState.userReactionsCounter);
  const latestUsersReactionsCounters = usersReactionsCountersMap.getRoot();

  const initialTargetsReactionsCounters = targetsReactionsCountersMap.getRoot();
  const targetReactionsCounterWitness = targetsReactionsCountersMap.getWitness(targetKeyAsField);
  targetsReactionsCountersMap.set(targetKeyAsField, reactionState.targetReactionsCounter);
  const latestTargetsReactionsCounters = targetsReactionsCountersMap.getRoot();

  const initialReactions = reactionsMap.getRoot();
  const reactionKey = Poseidon.hash([targetKeyAsField, reactorAddressAsField, reactionCodePointAsField]);
  const reactionWitness = reactionsMap.getWitness(reactionKey);
  reactionsMap.set(reactionKey, reactionState.hash());
  const latestReactions = reactionsMap.getRoot();

  const target = await prisma.posts.findUnique({
    where: {
      postKey: targetKey
    }
  });

  const postState = new PostState({
    posterAddress: PublicKey.fromBase58(target!.posterAddress),
    postContentID: CircuitString.fromString(target!.postContentID),
    allPostsCounter: Field(target!.allPostsCounter),
    userPostsCounter: Field(target!.userPostsCounter),
    postBlockHeight: Field(target!.postBlockHeight),
    deletionBlockHeight: Field(target!.deletionBlockHeight),
    restorationBlockHeight: Field(target!.restorationBlockHeight)
  });
  const targetWitness = postsMap.getWitness(targetKeyAsField);

  const transition = ReactionsTransition.createReactionPublishingTransition(
    signature,
    postsMap.getRoot(),
    postState,
    targetWitness,
    reactionState.allReactionsCounter.sub(1),
    initialUsersReactionsCounters,
    latestUsersReactionsCounters,
    reactionState.userReactionsCounter.sub(1),
    userReactionsCounterWitness,
    initialTargetsReactionsCounters,
    latestTargetsReactionsCounters,
    reactionState.targetReactionsCounter.sub(1),
    targetReactionsCounterWitness,
    initialReactions,
    latestReactions,
    reactionWitness,
    reactionState
  );
  console.log('Transition created');
  
  const proof = await Reactions.proveReactionPublishingTransition(
    transition,
    signature,
    postsMap.getRoot(),
    postState,
    targetWitness,
    reactionState.allReactionsCounter.sub(1),
    initialUsersReactionsCounters,
    latestUsersReactionsCounters,
    reactionState.userReactionsCounter.sub(1),
    userReactionsCounterWitness,
    initialTargetsReactionsCounters,
    latestTargetsReactionsCounters,
    reactionState.targetReactionsCounter.sub(1),
    targetReactionsCounterWitness,
    initialReactions,
    latestReactions,
    reactionWitness,
    reactionState
  );
  console.log('Proof created');

  return {transition: transition, proof: proof};
}

// ============================================================================

async function updateReactionsOnChainState(transitionsAndProofs: {
  transition: ReactionsTransition,
  proof: ReactionsProof
}[]) {
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    () => {
      reactionsContract.update(transitionsAndProofs[0].proof);
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

// ============================================================================