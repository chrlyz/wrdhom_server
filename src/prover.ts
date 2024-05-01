import { CircuitString, PublicKey, Signature, fetchLastBlock,
  MerkleMap, Field, Poseidon, Mina, PrivateKey,
  fetchAccount, Cache, Bool } from 'o1js';
import { Config, PostState, PostsTransition, Posts,
  PostsContract, PostsProof, ReactionState,
  ReactionsTransition, Reactions, ReactionsContract,
  ReactionsProof, CommentState, CommentsTransition, Comments,
  CommentsContract, CommentsProof, Reposts, RepostsContract,
  RepostsTransition, RepostsProof, RepostState
} from 'wrdhom';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  regenerateCommentsZkAppState,
  regeneratePostsZkAppState,
  regenerateReactionsZkAppState,
  regenerateRepostsZkAppState
} from './utils/state.js';
import * as dotenv from 'dotenv';
import { Queue, QueueEvents } from 'bullmq';

// ============================================================================

// Load .env
dotenv.config();

// Set up client for PostgreSQL for structured data
const prisma = new PrismaClient();

// Define connection to Redis instance for BullMQ
const connection = {
  host: 'localhost',
  port: 6379
}

const queue = new Queue('queue', {connection});
const queueEvents = new QueueEvents('queue', {connection});
const mergingQueue = new Queue('mergingQueue', {connection});
const mergingQueueEvents = new QueueEvents('mergingQueue', {connection});
const postDeletionsQueue = new Queue('postDeletionsQueue', {connection});
const postDeletionsQueueEvents = new QueueEvents('postDeletionsQueue', {connection});
const postRestorationsQueue = new Queue('postRestorationsQueue', {connection});
const postRestorationsQueueEvents = new QueueEvents('postRestorationsQueue', {connection});
const reactionsQueue = new Queue('reactionsQueue', {connection});
const reactionsQueueEvents = new QueueEvents('reactionsQueue', {connection});
const mergingReactionsQueue = new Queue('mergingReactionsQueue', {connection});
const mergingReactionsQueueEvents = new QueueEvents('mergingReactionsQueue', {connection});
const reactionDeletionsQueue = new Queue('reactionDeletionsQueue', {connection});
const reactionDeletionsQueueEvents = new QueueEvents('reactionDeletionsQueue', {connection});
const reactionRestorationsQueue = new Queue('reactionRestorationsQueue', {connection});
const reactionRestorationsQueueEvents = new QueueEvents('reactionRestorationsQueue', {connection});
const commentsQueue = new Queue('commentsQueue', {connection});
const commentsQueueEvents = new QueueEvents('commentsQueue', {connection});
const mergingCommentsQueue = new Queue('mergingCommentsQueue', {connection});
const mergingCommentsQueueEvents = new QueueEvents('mergingCommentsQueue', {connection});
const commentDeletionsQueue = new Queue('commentDeletionsQueue', {connection});
const commentDeletionsQueueEvents = new QueueEvents('commentDeletionsQueue', {connection});


// Load keys, and set up network and smart contract

const configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const configPosts = configJson.deployAliases['posts'];
const configReactions = configJson.deployAliases['reactions'];
const configComments = configJson.deployAliases['comments'];
const configReposts = configJson.deployAliases['reposts'];
const Network = Mina.Network(configPosts.url);
Mina.setActiveInstance(Network);
const fee = Number(configPosts.fee) * 1e9; // in nanomina (1 billion = 1.0 mina)
const feepayerKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(configPosts.feepayerKeyPath, 'utf8'));
const postsContractKeysBase58: { publicKey: string } =
  JSON.parse(await fs.readFile(configPosts.keyPath, 'utf8'));
const reactionsContractKeysBase58: { publicKey: string } =
  JSON.parse(await fs.readFile(configReactions.keyPath, 'utf8'));
const commentsContractKeysBase58: { publicKey: string } =
  JSON.parse(await fs.readFile(configComments.keyPath, 'utf8'));
const repostsContractKeysBase58: { publicKey: string } =
  JSON.parse(await fs.readFile(configReposts.keyPath, 'utf8'));
const feepayerKey = PrivateKey.fromBase58(feepayerKeysBase58.privateKey);
const feepayerAddress =   PublicKey.fromBase58(feepayerKeysBase58.publicKey);
const postsContractAddress = PublicKey.fromBase58(postsContractKeysBase58.publicKey);
const reactionsContractAddress = PublicKey.fromBase58(reactionsContractKeysBase58.publicKey);
const commentsContractAddress = PublicKey.fromBase58(commentsContractKeysBase58.publicKey);
const repostsContractAddress = PublicKey.fromBase58(repostsContractKeysBase58.publicKey);
// Fetch accounts to make sure they are available on cache during the execution of the program
await fetchAccount({ publicKey: feepayerKeysBase58.publicKey });
await fetchAccount({ publicKey: postsContractKeysBase58.publicKey });
await fetchAccount({ publicKey: reactionsContractKeysBase58.publicKey });
await fetchAccount({publicKey: commentsContractKeysBase58.publicKey});
await fetchAccount({publicKey: repostsContractKeysBase58.publicKey});
const postsContract = new PostsContract(postsContractAddress);
const reactionsContract = new ReactionsContract(reactionsContractAddress);
const commentsContract = new CommentsContract(commentsContractAddress);
const repostsContract = new RepostsContract(repostsContractAddress);

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
console.log('Compiling Comments ZkProgram...');
await Comments.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling CommentsContract...');
await CommentsContract.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling Reposts ZkProgram...');
await Reposts.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling RepostsContract...');
await RepostsContract.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiled');
let endTime = performance.now();
console.log(`${(endTime - startTime)/1000/60} minutes`);

// Regenerate Merkle maps from database

const usersPostsCountersMap = new MerkleMap();
const postsMap = new MerkleMap();
let totalNumberOfPosts = 0;

const postsContext = {
  prisma: prisma,
  usersPostsCountersMap: usersPostsCountersMap,
  postsMap: postsMap,
  totalNumberOfPosts: totalNumberOfPosts
}

await regeneratePostsZkAppState(postsContext);

const usersReactionsCountersMap = new MerkleMap();
const targetsReactionsCountersMap =  new MerkleMap();
const reactionsMap = new MerkleMap();
let totalNumberOfReactions = 0;

const reactionsContext = {
  prisma: prisma,
  usersReactionsCountersMap: usersReactionsCountersMap,
  targetsReactionsCountersMap: targetsReactionsCountersMap,
  reactionsMap: reactionsMap,
  totalNumberOfReactions: totalNumberOfReactions
}

await regenerateReactionsZkAppState(reactionsContext);

const usersCommentsCountersMap = new MerkleMap();
const targetsCommentsCountersMap =  new MerkleMap();
const commentsMap = new MerkleMap();
let totalNumberOfComments = 0;

const commentsContext = {
  prisma: prisma,
  usersCommentsCountersMap: usersCommentsCountersMap,
  targetsCommentsCountersMap: targetsCommentsCountersMap,
  commentsMap: commentsMap,
  totalNumberOfComments: totalNumberOfComments
}

await regenerateCommentsZkAppState(commentsContext);

const usersRepostsCountersMap = new MerkleMap();
const targetsRepostsCountersMap =  new MerkleMap();
const repostsMap = new MerkleMap();
let totalNumberOfReposts = 0;

const repostsContext = {
  prisma: prisma,
  usersRepostsCountersMap: usersRepostsCountersMap,
  targetsRepostsCountersMap: targetsRepostsCountersMap,
  repostsMap: repostsMap,
  totalNumberOfReposts: totalNumberOfReposts
}

await regenerateRepostsZkAppState(repostsContext);

const provingPosts = 0;
const provingReactions = 1;
const provingComments = 2;
const provingReposts = 3;
const provingPostDeletions = 4;
const provingPostRestorations = 5;
const provingCommentDeletions = 6;
const provingCommentRestorations = 7;
const provingRepostDeletions = 8;
const provingRepostRestorations = 9;
const provingReactionDeletions = 10;
const provingReactionRestorations = 11;
let provingTurn = 0;

while (true) {
  if (provingTurn === provingPosts) {
  // Process pending posts to update on-chain state

  const pendingPosts = await prisma.posts.findMany({
    take: 3,
    orderBy: {
        allPostsCounter: 'asc'
    },
    where: {
        postBlockHeight: 0
    }
    });
    postsContext.totalNumberOfPosts += pendingPosts.length;
    console.log('Number of posts if update is successful: ' + postsContext.totalNumberOfPosts);
    console.log('pendingPosts:');
    console.log(pendingPosts);
  
    startTime = performance.now();
  
    const lastBlock = await fetchLastBlock(configPosts.url);
    const postBlockHeight = lastBlock.blockchainLength.toBigint();
    console.log(postBlockHeight);

    const provePostInputs: {
      signature: string,
      transition: string,
      postState: string,
      initialUsersPostsCounters: string,
      latestUsersPostsCounters: string,
      initialPosts: string,
      latestPosts: string,
      userPostsCounterWitness: string,
      postWitness: string
    }[] = [];
  
    for (const pPost of pendingPosts) {
      const result = await generateProvePostInputs(
        pPost.postSignature,
        pPost.posterAddress,
        pPost.postContentID,
        pPost.allPostsCounter,
        pPost.userPostsCounter,
        postBlockHeight,
        pPost.deletionBlockHeight,
        pPost.restorationBlockHeight
      );
  
      provePostInputs.push(result);
    }

    const jobsPromises: Promise<any>[] = [];

    for (const provePostInput of provePostInputs) {
      const job = await queue.add(
        `job`,
        { provePostInput: provePostInput }
      );
      jobsPromises.push(job.waitUntilFinished(queueEvents));
    }

    const transitionsAndProofsAsStrings: {
      transition: string;
      proof: string;
    }[] = await Promise.all(jobsPromises);
  
    const transitionsAndProofs: {
      transition: PostsTransition,
      proof: PostsProof
    }[] = [];
  
    transitionsAndProofsAsStrings.forEach(transitionAndProof => {
      transitionsAndProofs.push({
        transition: PostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
        proof: PostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
      });
    });

    endTime = performance.now();
    console.log(`${(endTime - startTime)/1000/60} minutes`);
  
    if (transitionsAndProofs.length !== 0) {
      startTime = performance.now();
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
  
        console.log(Field(postsContext.totalNumberOfPosts).toString());
        console.log(usersPostsCountersMap.getRoot().toString());
        console.log(postsMap.getRoot().toString());
  
        console.log(allPostsCounterFetch?.equals(Field(postsContext.totalNumberOfPosts)).toBoolean());
        console.log(usersPostsCountersFetch?.equals(usersPostsCountersMap.getRoot()).toBoolean());
        console.log(postsFetch?.equals(postsMap.getRoot()).toBoolean());
  
        if (allPostsCounterFetch?.equals(Field(postsContext.totalNumberOfPosts)).toBoolean()
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
          postsContext.totalNumberOfPosts -= pendingPosts.length;
          console.log('Original number of posts: ' + postsContext.totalNumberOfPosts);
  
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
      take: 3,
      orderBy: {
          allReactionsCounter: 'asc'
      },
      where: {
          reactionBlockHeight: 0
      }
      });
      reactionsContext.totalNumberOfReactions += pendingReactions.length;
      console.log('Number of reactions if update is successful: ' + reactionsContext.totalNumberOfReactions);
      console.log('pendingReactions:');
      console.log(pendingReactions);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configReactions.url);
      const reactionBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(reactionBlockHeight);

      const proveReactionInputs: {
        transition: string,
        signature: string,
        targets: string,
        postState: string,
        targetWitness: string,
        reactionState: string,
        initialUsersReactionsCounters: string,
        latestUsersReactionsCounters: string,
        userReactionsCounterWitness: string,
        initialTargetsReactionsCounters: string,
        latestTargetsReactionsCounters: string,
        targetReactionsCounterWitness: string,
        initialReactions: string,
        latestReactions: string,
        reactionWitness: string
      }[] = [];
    
      for (const pReaction of pendingReactions) {
        const result = await generateProveReactionInputs(
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
    
        proveReactionInputs.push(result);
      }

      const jobsPromises: Promise<any>[] = [];

      for (const proveReactionInput of proveReactionInputs) {
        const job = await reactionsQueue.add(
          `job`,
          { proveReactionInput: proveReactionInput }
        );
        jobsPromises.push(job.waitUntilFinished(reactionsQueueEvents));
      }
  
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
    
      const transitionsAndProofs: {
        transition: ReactionsTransition,
        proof: ReactionsProof
      }[] = [];
    
      transitionsAndProofsAsStrings.forEach(transitionAndProof => {
        transitionsAndProofs.push({
          transition: ReactionsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: ReactionsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      });
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);
    
      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
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
    
          console.log(Field(reactionsContext.totalNumberOfReactions).toString());
          console.log(usersReactionsCountersMap.getRoot().toString());
          console.log(targetsReactionsCountersMap.getRoot().toString());
          console.log(reactionsMap.getRoot().toString());
    
          console.log(allReactionsCounterFetch?.equals(Field(reactionsContext.totalNumberOfReactions)).toBoolean());
          console.log(userReactionsCounterFetch?.equals(usersReactionsCountersMap.getRoot()).toBoolean());
          console.log(targetReactionsCounterFetch?.equals(targetsReactionsCountersMap.getRoot()).toBoolean());
          console.log(reactionsFetch?.equals(reactionsMap.getRoot()).toBoolean());
    
          if (allReactionsCounterFetch?.equals(Field(reactionsContext.totalNumberOfReactions)).toBoolean()
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
            reactionsContext.totalNumberOfReactions -= pendingReactions.length;
            console.log('Original number of reactions: ' + reactionsContext.totalNumberOfReactions);
    
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
      }
  } else if (provingTurn === provingComments) {

    const pendingComments = await prisma.comments.findMany({
      take: 3,
      orderBy: {
          allCommentsCounter: 'asc'
      },
      where: {
          commentBlockHeight: 0
      }
      });
      commentsContext.totalNumberOfComments += pendingComments.length;
      console.log('Number of comments if update is successful: ' + commentsContext.totalNumberOfComments);
      console.log('pendingComments:');
      console.log(pendingComments);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configComments.url);
      const commentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(commentBlockHeight);

      const proveCommentInputs: {
        transition: string,
        signature: string,
        targets: string,
        postState: string,
        targetWitness: string,
        commentState: string,
        initialUsersCommentsCounters: string,
        latestUsersCommentsCounters: string,
        userCommentsCounterWitness: string,
        initialTargetsCommentsCounters: string,
        latestTargetsCommentsCounters: string,
        targetCommentsCounterWitness: string,
        initialComments: string,
        latestComments: string,
        commentWitness: string
      }[] = []
    
      for (const pComment of pendingComments) {
        const result = await generateProveCommentInputs(
          pComment.isTargetPost,
          pComment.targetKey,
          pComment.commenterAddress,
          pComment.commentContentID,
          pComment.allCommentsCounter,
          pComment.userCommentsCounter,
          pComment.targetCommentsCounter,
          commentBlockHeight,
          pComment.deletionBlockHeight,
          pComment.restorationBlockHeight,
          pComment.commentSignature
        );
    
        proveCommentInputs.push(result);
      }

      const jobsPromises: Promise<any>[] = [];

      for (const proveCommentInput of proveCommentInputs) {
        const job = await commentsQueue.add(
          `job`,
          { proveCommentInput: proveCommentInput }
        );
        jobsPromises.push(job.waitUntilFinished(commentsQueueEvents));
      }
  
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
    
      const transitionsAndProofs: {
        transition: CommentsTransition,
        proof: CommentsProof
      }[] = [];
    
      transitionsAndProofsAsStrings.forEach(transitionAndProof => {
        transitionsAndProofs.push({
          transition: CommentsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: CommentsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      });
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);
    
      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
        await updateCommentsOnChainState(transitionsAndProofs);
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allCommentsCounterFetch;
        let userCommentsCounterFetch;
        let targetCommentsCounterFetch;
        let commentsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allCommentsCounterFetch = await commentsContract.allCommentsCounter.fetch();
          console.log('allCommentsCounterFetch: ' + allCommentsCounterFetch?.toString());
          userCommentsCounterFetch = await commentsContract.usersCommentsCounters.fetch();
          console.log('userCommentsCounterFetch: ' + userCommentsCounterFetch?.toString());
          targetCommentsCounterFetch = await commentsContract.targetsCommentsCounters.fetch();
          console.log('targetCommentsCounterFetch: ' + targetCommentsCounterFetch?.toString());
          commentsFetch = await commentsContract.comments.fetch();
          console.log('commentsFetch: ' + commentsFetch?.toString());
    
          console.log(Field(commentsContext.totalNumberOfComments).toString());
          console.log(usersCommentsCountersMap.getRoot().toString());
          console.log(targetsCommentsCountersMap.getRoot().toString());
          console.log(commentsMap.getRoot().toString());
    
          console.log(allCommentsCounterFetch?.equals(Field(commentsContext.totalNumberOfComments)).toBoolean());
          console.log(userCommentsCounterFetch?.equals(usersCommentsCountersMap.getRoot()).toBoolean());
          console.log(targetCommentsCounterFetch?.equals(targetsCommentsCountersMap.getRoot()).toBoolean());
          console.log(commentsFetch?.equals(commentsMap.getRoot()).toBoolean());
    
          if (allCommentsCounterFetch?.equals(Field(commentsContext.totalNumberOfComments)).toBoolean()
          && userCommentsCounterFetch?.equals(usersCommentsCountersMap.getRoot()).toBoolean()
          && targetCommentsCounterFetch?.equals(targetsCommentsCountersMap.getRoot()).toBoolean()
          && commentsFetch?.equals(commentsMap.getRoot()).toBoolean()) {
            for (const pComment of pendingComments) {
              await prisma.comments.update({
                  where: {
                    commentKey: pComment.commentKey
                  },
                  data: {
                    commentBlockHeight: commentBlockHeight
                  }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {
            commentsContext.totalNumberOfComments -= pendingComments.length;
            console.log('Original number of comments: ' + commentsContext.totalNumberOfComments);
    
            const pendingCommenters = new Set(pendingComments.map( comment => comment.commenterAddress));
            for (const commenter of pendingCommenters) {
              const userComments = await prisma.comments.findMany({
                where: {
                  commenterAddress: commenter,
                  commentBlockHeight: {
                    not: 0
                  }
                }
              });
              console.log(userComments);
              console.log('Initial usersCommentsCountersMap root: ' + usersCommentsCountersMap.getRoot().toString());
              usersCommentsCountersMap.set(
                Poseidon.hash(PublicKey.fromBase58(commenter).toFields()),
                Field(userComments.length)
              );
              console.log(userComments.length);
              console.log('Latest usersCommentsCountersMap root: ' + usersCommentsCountersMap.getRoot().toString());
            };

            const pendingTargets = new Set(pendingComments.map( comment => comment.targetKey));
            for (const target of pendingTargets) {
              const targetComments = await prisma.comments.findMany({
                where: {
                  targetKey: target,
                  commentBlockHeight: {
                    not: 0
                  }
                }
              })
              console.log('Initial targetsCommentsCountersMap root: ' + targetsCommentsCountersMap.getRoot().toString());
              targetsCommentsCountersMap.set(
                Field(target),
                Field(targetComments.length)
              );
              console.log(targetComments.length);
              console.log('Latest targetsCommentsCountersMap root: ' + targetsCommentsCountersMap.getRoot().toString());
            }

            pendingComments.forEach( pComment => {
              console.log('Initial commentsMap root: ' + commentsMap.getRoot().toString());
              commentsMap.set(
                  Field(pComment.commentKey),
                  Field(0)
              );
              console.log('Latest commentsMap root: ' + commentsMap.getRoot().toString());
            });
          }
          tries++;
        }
      }

  } else if (provingTurn === provingReposts) {

    const pendingReposts = await prisma.reposts.findMany({
      take: 1,
      orderBy: {
          allRepostsCounter: 'asc'
      },
      where: {
          repostBlockHeight: 0
      }
      });
      repostsContext.totalNumberOfReposts += pendingReposts.length;
      console.log('Number of reposts if update is successful: ' + repostsContext.totalNumberOfReposts);
      console.log('pendingReposts:');
      console.log(pendingReposts);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configReposts.url);
      const repostBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(repostBlockHeight);
    
      const transitionsAndProofs: {
        transition: RepostsTransition,
        proof: RepostsProof
      }[] = [];
    
      for (const pRepost of pendingReposts) {
        const result = await proveRepost(
          pRepost.isTargetPost,
          pRepost.targetKey,
          pRepost.reposterAddress,
          pRepost.allRepostsCounter,
          pRepost.userRepostsCounter,
          pRepost.targetRepostsCounter,
          repostBlockHeight,
          pRepost.deletionBlockHeight,
          pRepost.restorationBlockHeight,
          pRepost.repostSignature
        );
    
        transitionsAndProofs.push(result);
      }
    
      if (transitionsAndProofs.length !== 0) {
        await updateRepostsOnChainState(transitionsAndProofs);
    
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allRepostsCounterFetch;
        let userRepostsCounterFetch;
        let targetRepostsCounterFetch;
        let repostsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allRepostsCounterFetch = await repostsContract.allRepostsCounter.fetch();
          console.log('allRepostsCounterFetch: ' + allRepostsCounterFetch?.toString());
          userRepostsCounterFetch = await repostsContract.usersRepostsCounters.fetch();
          console.log('userRepostsCounterFetch: ' + userRepostsCounterFetch?.toString());
          targetRepostsCounterFetch = await repostsContract.targetsRepostsCounters.fetch();
          console.log('targetRepostsCounterFetch: ' + targetRepostsCounterFetch?.toString());
          repostsFetch = await repostsContract.reposts.fetch();
          console.log('repostsFetch: ' + repostsFetch?.toString());
    
          console.log(Field(repostsContext.totalNumberOfReposts).toString());
          console.log(usersRepostsCountersMap.getRoot().toString());
          console.log(targetsRepostsCountersMap.getRoot().toString());
          console.log(repostsMap.getRoot().toString());
    
          console.log(allRepostsCounterFetch?.equals(Field(repostsContext.totalNumberOfReposts)).toBoolean());
          console.log(userRepostsCounterFetch?.equals(usersRepostsCountersMap.getRoot()).toBoolean());
          console.log(targetRepostsCounterFetch?.equals(targetsRepostsCountersMap.getRoot()).toBoolean());
          console.log(repostsFetch?.equals(repostsMap.getRoot()).toBoolean());
    
          if (allRepostsCounterFetch?.equals(Field(repostsContext.totalNumberOfReposts)).toBoolean()
          && userRepostsCounterFetch?.equals(usersRepostsCountersMap.getRoot()).toBoolean()
          && targetRepostsCounterFetch?.equals(targetsRepostsCountersMap.getRoot()).toBoolean()
          && repostsFetch?.equals(repostsMap.getRoot()).toBoolean()) {
            for (const pRepost of pendingReposts) {
              await prisma.reposts.update({
                  where: {
                    repostKey: pRepost.repostKey
                  },
                  data: {
                    repostBlockHeight: repostBlockHeight
                  }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {
            repostsContext.totalNumberOfReposts -= pendingReposts.length;
            console.log('Original number of reposts: ' + repostsContext.totalNumberOfReposts);
    
            const pendingReposters = new Set(pendingReposts.map( repost => repost.reposterAddress));
            for (const reposter of pendingReposters) {
              const userReposts = await prisma.reposts.findMany({
                where: {
                  reposterAddress: reposter,
                  repostBlockHeight: {
                    not: 0
                  }
                }
              });
              console.log(userReposts);
              console.log('Initial usersRepostsCountersMap root: ' + usersRepostsCountersMap.getRoot().toString());
              usersRepostsCountersMap.set(
                Poseidon.hash(PublicKey.fromBase58(reposter).toFields()),
                Field(userReposts.length)
              );
              console.log(userReposts.length);
              console.log('Latest usersRepostsCountersMap root: ' + usersRepostsCountersMap.getRoot().toString());
            };

            const pendingTargets = new Set(pendingReposts.map( repost => repost.targetKey));
            for (const target of pendingTargets) {
              const targetReposts = await prisma.reposts.findMany({
                where: {
                  targetKey: target,
                  repostBlockHeight: {
                    not: 0
                  }
                }
              })
              console.log('Initial targetsRepostsCountersMap root: ' + targetsRepostsCountersMap.getRoot().toString());
              targetsRepostsCountersMap.set(
                Field(target),
                Field(targetReposts.length)
              );
              console.log(targetReposts.length);
              console.log('Latest targetsRepostsCountersMap root: ' + targetsRepostsCountersMap.getRoot().toString());
            }

            pendingReposts.forEach( pRepost => {
              console.log('Initial repostsMap root: ' + repostsMap.getRoot().toString());
              repostsMap.set(
                  Field(pRepost.repostKey),
                  Field(0)
              );
              console.log('Latest repostsMap root: ' + repostsMap.getRoot().toString());
            });
          }
          tries++;
        }
      }
  } else if (provingTurn === provingPostDeletions) {

    const pendingDeletions = await prisma.postDeletions.findMany({
      take: 3,
      orderBy: {
          allDeletionsCounter: 'asc'
      },
      where: {
          deletionBlockHeight: 0
      }
      });
      console.log('pendingDeletions:');
      console.log(pendingDeletions);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configPosts.url);
      const deletionBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(deletionBlockHeight);

      const currentAllPostsCounter = await prisma.posts.count();

      const provePostDeletionInputs: {
        transition: string,
        signature: string,
        currentAllPostsCounter: string,
        usersPostsCounters: string,
        initialPosts: string,
        latestPosts: string,
        initialPostState: string,
        postWitness: string,
        deletionBlockHeight: string
      }[] = [];
    
      for (const pDeletion of pendingDeletions) {

        const target = await prisma.posts.findUnique({
          where: {
            postKey: pDeletion.targetKey
          }
        });

        const result = await generatePostDeletionInputs(
          target!.posterAddress,
          target!.postContentID,
          target!.allPostsCounter,
          target!.userPostsCounter,
          target!.postBlockHeight,
          target!.restorationBlockHeight,
          Field(target!.postKey),
          pDeletion.deletionSignature,
          Field(deletionBlockHeight),
          Field(currentAllPostsCounter)
        );

        provePostDeletionInputs.push(result);
      }

      const jobsPromises: Promise<any>[] = [];

      for (const provePostDeletionInput of provePostDeletionInputs) {
        const job = await postDeletionsQueue.add(
          `job`,
          { provePostDeletionInput: provePostDeletionInput }
        );
        jobsPromises.push(job.waitUntilFinished(postDeletionsQueueEvents));
      }
  
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
    
      const transitionsAndProofs: {
        transition: PostsTransition,
        proof: PostsProof
      }[] = [];
    
      transitionsAndProofsAsStrings.forEach(transitionAndProof => {
        transitionsAndProofs.push({
          transition: PostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: PostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      });
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);

      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
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
    
          console.log(Field(postsContext.totalNumberOfPosts).toString());
          console.log(usersPostsCountersMap.getRoot().toString());
          console.log(postsMap.getRoot().toString());
    
          console.log(allPostsCounterFetch?.equals(Field(postsContext.totalNumberOfPosts)).toBoolean());
          console.log(usersPostsCountersFetch?.equals(usersPostsCountersMap.getRoot()).toBoolean());
          console.log(postsFetch?.equals(postsMap.getRoot()).toBoolean());
    
          if (allPostsCounterFetch?.equals(Field(postsContext.totalNumberOfPosts)).toBoolean()
          && usersPostsCountersFetch?.equals(usersPostsCountersMap.getRoot()).toBoolean()
          && postsFetch?.equals(postsMap.getRoot()).toBoolean()) {
            for (const pDeletion of pendingDeletions) {
              await prisma.posts.update({
                  where: {
                    postKey: pDeletion.targetKey
                  },
                  data: {
                    deletionBlockHeight: deletionBlockHeight
                  }
              });

              await prisma.postDeletions.update({
                where: {
                  allDeletionsCounter: pDeletion.allDeletionsCounter
                },
                data: {
                  deletionBlockHeight: deletionBlockHeight
                }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {

            for (const pDeletion of pendingDeletions) {

              const target = await prisma.posts.findUnique({
                where: {
                  postKey: pDeletion.targetKey
                }
              });

              const posterAddress = PublicKey.fromBase58(target!.posterAddress);
              const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
              const postContentID = CircuitString.fromString(target!.postContentID);

              const restoredTargetState = new PostState({
                posterAddress: posterAddress,
                postContentID: postContentID,
                allPostsCounter: Field(target!.allPostsCounter),
                userPostsCounter: Field(target!.userPostsCounter),
                postBlockHeight: Field(target!.postBlockHeight),
                deletionBlockHeight: Field(target!.deletionBlockHeight),
                restorationBlockHeight: Field(target!.restorationBlockHeight)
              });

              console.log('Initial postsMap root: ' + postsMap.getRoot().toString());
              postsMap.set(
                  Poseidon.hash([posterAddressAsField, postContentID.hash()]),
                  restoredTargetState.hash()
              );
              console.log('Latest postsMap root: ' + postsMap.getRoot().toString());
            }
          }
          tries++;
        }
      }
  }  else if (provingTurn === provingPostRestorations) {

    const pendingRestorations = await prisma.postRestorations.findMany({
      take: 3,
      orderBy: {
          allRestorationsCounter: 'asc'
      },
      where: {
          restorationBlockHeight: 0
      }
      });
      console.log('pendingRestorations:');
      console.log(pendingRestorations);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configPosts.url);
      const restorationBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(restorationBlockHeight);

      const currentAllPostsCounter = await prisma.posts.count();

      const inputs: {
        transition: string,
        signature: string,
        currentAllPostsCounter: string,
        usersPostsCounters: string,
        initialPosts: string,
        latestPosts: string,
        initialPostState: string,
        postWitness: string,
        restorationBlockHeight: string
      }[] = [];
    
      for (const pRestoration of pendingRestorations) {

        const target = await prisma.posts.findUnique({
          where: {
            postKey: pRestoration.targetKey
          }
        });

        const result = await generatePostRestorationInputs(
          target!.posterAddress,
          target!.postContentID,
          target!.allPostsCounter,
          target!.userPostsCounter,
          target!.postBlockHeight,
          target!.deletionBlockHeight,
          target!.restorationBlockHeight,
          Field(target!.postKey),
          pRestoration.restorationSignature,
          Field(restorationBlockHeight),
          Field(currentAllPostsCounter)
        );

        inputs.push(result);
      }

      const jobsPromises: Promise<any>[] = [];

      for (const input of inputs) {
        const job = await postRestorationsQueue.add(
          `job`,
          { inputs: input }
        );
        jobsPromises.push(job.waitUntilFinished(postRestorationsQueueEvents));
      }
  
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
    
      const transitionsAndProofs: {
        transition: PostsTransition,
        proof: PostsProof
      }[] = [];
    
      transitionsAndProofsAsStrings.forEach(transitionAndProof => {
        transitionsAndProofs.push({
          transition: PostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: PostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      });
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);


      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
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
    
          console.log(Field(postsContext.totalNumberOfPosts).toString());
          console.log(usersPostsCountersMap.getRoot().toString());
          console.log(postsMap.getRoot().toString());
    
          console.log(allPostsCounterFetch?.equals(Field(postsContext.totalNumberOfPosts)).toBoolean());
          console.log(usersPostsCountersFetch?.equals(usersPostsCountersMap.getRoot()).toBoolean());
          console.log(postsFetch?.equals(postsMap.getRoot()).toBoolean());
    
          if (allPostsCounterFetch?.equals(Field(postsContext.totalNumberOfPosts)).toBoolean()
          && usersPostsCountersFetch?.equals(usersPostsCountersMap.getRoot()).toBoolean()
          && postsFetch?.equals(postsMap.getRoot()).toBoolean()) {
            for (const pRestoration of pendingRestorations) {
              await prisma.posts.update({
                  where: {
                    postKey: pRestoration.targetKey
                  },
                  data: {
                    deletionBlockHeight: 0,
                    restorationBlockHeight: restorationBlockHeight
                  }
              });

              await prisma.postRestorations.update({
                where: {
                  allRestorationsCounter: pRestoration.allRestorationsCounter
                },
                data: {
                  restorationBlockHeight: restorationBlockHeight
                }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {

            for (const pRestoration of pendingRestorations) {

              const target = await prisma.posts.findUnique({
                where: {
                  postKey: pRestoration.targetKey
                }
              });

              const posterAddress = PublicKey.fromBase58(target!.posterAddress);
              const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
              const postContentID = CircuitString.fromString(target!.postContentID);

              const restoredTargetState = new PostState({
                posterAddress: posterAddress,
                postContentID: postContentID,
                allPostsCounter: Field(target!.allPostsCounter),
                userPostsCounter: Field(target!.userPostsCounter),
                postBlockHeight: Field(target!.postBlockHeight),
                deletionBlockHeight: Field(target!.deletionBlockHeight),
                restorationBlockHeight: Field(target!.restorationBlockHeight)
              });

              console.log('Initial postsMap root: ' + postsMap.getRoot().toString());
              postsMap.set(
                  Poseidon.hash([posterAddressAsField, postContentID.hash()]),
                  restoredTargetState.hash()
              );
              console.log('Latest postsMap root: ' + postsMap.getRoot().toString());
            }
          }
          tries++;
        }
      }
  } else if (provingTurn === provingCommentDeletions) {

    const pendingCommentDeletions = await prisma.commentDeletions.findMany({
      take: 3,
      orderBy: {
          allDeletionsCounter: 'asc'
      },
      where: {
          deletionBlockHeight: 0
      }
      });
      console.log('pendingCommentDeletions:');
      console.log(pendingCommentDeletions);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configComments.url);
      const deletionBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(deletionBlockHeight);

      const currentAllCommentsCounter = await prisma.comments.count();
    
      const proveCommentDeletionInputs: {
        transition: string,
        signature: string,
        targets: string,
        postState: string,
        targetWitness: string,
        currentAllCommentsCounter: string,
        usersCommentsCounters: string,
        targetsCommentsCounters: string,
        initialComments: string,
        latestComments: string,
        initialCommentState: string,
        commentWitness: string,
        deletionBlockHeight: string
      }[] = [];
    
      for (const pDeletion of pendingCommentDeletions) {

        const comment = await prisma.comments.findUnique({
          where: {
            commentKey: pDeletion.targetKey
          }
        });

        const parent = await prisma.posts.findUnique({
          where: {
            postKey: comment!.targetKey
          }
        });

        const result = await generateProveCommentDeletionInputs(
          parent,
          comment!.isTargetPost,
          comment!.targetKey,
          comment!.commenterAddress,
          comment!.commentContentID,
          comment!.allCommentsCounter,
          comment!.userCommentsCounter,
          comment!.targetCommentsCounter,
          comment!.commentBlockHeight,
          comment!.restorationBlockHeight,
          Field(comment!.commentKey),
          pDeletion.deletionSignature,
          Field(deletionBlockHeight),
          Field(currentAllCommentsCounter)
        );
    
        proveCommentDeletionInputs.push(result);
      }

      const jobsPromises: Promise<any>[] = [];

      for (const proveCommentDeletionInput of proveCommentDeletionInputs) {
        const job = await commentDeletionsQueue.add(
          `job`,
          { proveCommentDeletionInput: proveCommentDeletionInput }
        );
        jobsPromises.push(job.waitUntilFinished(commentDeletionsQueueEvents));
      }
  
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
    
      const transitionsAndProofs: {
        transition: CommentsTransition,
        proof: CommentsProof
      }[] = [];
    
      transitionsAndProofsAsStrings.forEach(transitionAndProof => {
        transitionsAndProofs.push({
          transition: CommentsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: CommentsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      });
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);

      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
        await updateCommentsOnChainState(transitionsAndProofs);
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allCommentsCounterFetch;
        let usersCommentsCountersFetch;
        let targetsCommentsCountersFetch;
        let commentsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allCommentsCounterFetch = await commentsContract.allCommentsCounter.fetch();
          console.log('allCommentsCounterFetch: ' + allCommentsCounterFetch?.toString());
          usersCommentsCountersFetch = await commentsContract.usersCommentsCounters.fetch();
          console.log('usersCommentsCountersFetch: ' + usersCommentsCountersFetch?.toString());
          targetsCommentsCountersFetch = await commentsContract.targetsCommentsCounters.fetch();
          console.log('targetsCommentsCountersFetch: ' + targetsCommentsCountersFetch?.toString());
          commentsFetch = await commentsContract.comments.fetch();
          console.log('commentsFetch: ' + commentsFetch?.toString());
    
          console.log(Field(commentsContext.totalNumberOfComments).toString());
          console.log(usersCommentsCountersMap.getRoot().toString());
          console.log(targetsCommentsCountersMap.getRoot().toString());
          console.log(commentsMap.getRoot().toString());
    
          console.log(allCommentsCounterFetch?.equals(Field(commentsContext.totalNumberOfComments)).toBoolean());
          console.log(usersCommentsCountersFetch?.equals(usersCommentsCountersMap.getRoot()).toBoolean());
          console.log(targetsCommentsCountersFetch?.equals(targetsCommentsCountersMap.getRoot()).toBoolean());
          console.log(commentsFetch?.equals(commentsMap.getRoot()).toBoolean());
    
          if (allCommentsCounterFetch?.equals(Field(commentsContext.totalNumberOfComments)).toBoolean()
          && usersCommentsCountersFetch?.equals(usersCommentsCountersMap.getRoot()).toBoolean()
          && targetsCommentsCountersFetch?.equals(targetsCommentsCountersMap.getRoot()).toBoolean()
          && commentsFetch?.equals(commentsMap.getRoot()).toBoolean()) {
            for (const pDeletion of pendingCommentDeletions) {
              await prisma.comments.update({
                  where: {
                    commentKey: pDeletion.targetKey
                  },
                  data: {
                    deletionBlockHeight: deletionBlockHeight
                  }
              });

              await prisma.commentDeletions.update({
                where: {
                  allDeletionsCounter: pDeletion.allDeletionsCounter
                },
                data: {
                  deletionBlockHeight: deletionBlockHeight
                }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {

            for (const pDeletion of pendingCommentDeletions) {

              const target = await prisma.comments.findUnique({
                where: {
                  commentKey: pDeletion.targetKey
                }
              });

              const commenterAddress = PublicKey.fromBase58(target!.commenterAddress);
              const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
              const commentContentID = CircuitString.fromString(target!.commentContentID);
        
              const restoredTargetState = new CommentState({
                isTargetPost: Bool(target!.isTargetPost),
                targetKey: Field(target!.targetKey),
                commenterAddress: commenterAddress,
                commentContentID: commentContentID,
                allCommentsCounter: Field(target!.allCommentsCounter),
                userCommentsCounter: Field(target!.userCommentsCounter),
                commentBlockHeight: Field(target!.commentBlockHeight),
                targetCommentsCounter: Field(target!.targetCommentsCounter),
                deletionBlockHeight: Field(target!.deletionBlockHeight),
                restorationBlockHeight: Field(target!.restorationBlockHeight)
              });

              console.log('Initial commentsMap root: ' + commentsMap.getRoot().toString());
              commentsMap.set(
                  Poseidon.hash([Field(target!.targetKey), commenterAddressAsField, commentContentID.hash()]),
                  restoredTargetState.hash()
              );
              console.log('Latest commentsMap root: ' + commentsMap.getRoot().toString());
            }
          }
          tries++;
        }
      }
  } else if (provingTurn === provingCommentRestorations) {

    const pendingCommentRestorations = await prisma.commentRestorations.findMany({
      take: 1,
      orderBy: {
          allRestorationsCounter: 'asc'
      },
      where: {
          restorationBlockHeight: 0
      }
      });
      console.log('pendingCommentRestorations:');
      console.log(pendingCommentRestorations);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configComments.url);
      const restorationBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(restorationBlockHeight);

      const currentAllCommentsCounter = await prisma.comments.count();
    
      const transitionsAndProofs: {
        transition: CommentsTransition,
        proof: CommentsProof
      }[] = [];
    
      for (const pRestoration of pendingCommentRestorations) {

        const comment = await prisma.comments.findUnique({
          where: {
            commentKey: pRestoration.targetKey
          }
        });

        const parent = await prisma.posts.findUnique({
          where: {
            postKey: comment!.targetKey
          }
        });

        const result = await proveCommentRestoration(
          parent,
          comment!.isTargetPost,
          comment!.targetKey,
          comment!.commenterAddress,
          comment!.commentContentID,
          comment!.allCommentsCounter,
          comment!.userCommentsCounter,
          comment!.targetCommentsCounter,
          comment!.commentBlockHeight,
          comment!.deletionBlockHeight,
          comment!.restorationBlockHeight,
          Field(comment!.commentKey),
          pRestoration.restorationSignature,
          Field(restorationBlockHeight),
          Field(currentAllCommentsCounter)
        );
    
        transitionsAndProofs.push(result);
      }

      if (transitionsAndProofs.length !== 0) {
        await updateCommentsOnChainState(transitionsAndProofs);
    
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allCommentsCounterFetch;
        let usersCommentsCountersFetch;
        let targetsCommentsCountersFetch;
        let commentsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allCommentsCounterFetch = await commentsContract.allCommentsCounter.fetch();
          console.log('allCommentsCounterFetch: ' + allCommentsCounterFetch?.toString());
          usersCommentsCountersFetch = await commentsContract.usersCommentsCounters.fetch();
          console.log('usersCommentsCountersFetch: ' + usersCommentsCountersFetch?.toString());
          targetsCommentsCountersFetch = await commentsContract.targetsCommentsCounters.fetch();
          console.log('targetsCommentsCountersFetch: ' + targetsCommentsCountersFetch?.toString());
          commentsFetch = await commentsContract.comments.fetch();
          console.log('commentsFetch: ' + commentsFetch?.toString());
    
          console.log(Field(commentsContext.totalNumberOfComments).toString());
          console.log(usersCommentsCountersMap.getRoot().toString());
          console.log(targetsCommentsCountersMap.getRoot().toString());
          console.log(commentsMap.getRoot().toString());
    
          console.log(allCommentsCounterFetch?.equals(Field(commentsContext.totalNumberOfComments)).toBoolean());
          console.log(usersCommentsCountersFetch?.equals(usersCommentsCountersMap.getRoot()).toBoolean());
          console.log(targetsCommentsCountersFetch?.equals(targetsCommentsCountersMap.getRoot()).toBoolean());
          console.log(commentsFetch?.equals(commentsMap.getRoot()).toBoolean());
    
          if (allCommentsCounterFetch?.equals(Field(commentsContext.totalNumberOfComments)).toBoolean()
          && usersCommentsCountersFetch?.equals(usersCommentsCountersMap.getRoot()).toBoolean()
          && targetsCommentsCountersFetch?.equals(targetsCommentsCountersMap.getRoot()).toBoolean()
          && commentsFetch?.equals(commentsMap.getRoot()).toBoolean()) {
            for (const pRestoration of pendingCommentRestorations) {
              await prisma.comments.update({
                  where: {
                    commentKey: pRestoration.targetKey
                  },
                  data: {
                    deletionBlockHeight: 0,
                    restorationBlockHeight: restorationBlockHeight
                  }
              });

              await prisma.commentRestorations.update({
                where: {
                  allRestorationsCounter: pRestoration.allRestorationsCounter
                },
                data: {
                  restorationBlockHeight: restorationBlockHeight
                }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {

            for (const pRestoration of pendingCommentRestorations) {

              const target = await prisma.comments.findUnique({
                where: {
                  commentKey: pRestoration.targetKey
                }
              });

              const commenterAddress = PublicKey.fromBase58(target!.commenterAddress);
              const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
              const commentContentID = CircuitString.fromString(target!.commentContentID);
        
              const restoredTargetState = new CommentState({
                isTargetPost: Bool(target!.isTargetPost),
                targetKey: Field(target!.targetKey),
                commenterAddress: commenterAddress,
                commentContentID: commentContentID,
                allCommentsCounter: Field(target!.allCommentsCounter),
                userCommentsCounter: Field(target!.userCommentsCounter),
                commentBlockHeight: Field(target!.commentBlockHeight),
                targetCommentsCounter: Field(target!.targetCommentsCounter),
                deletionBlockHeight: Field(target!.deletionBlockHeight),
                restorationBlockHeight: Field(target!.restorationBlockHeight)
              });

              console.log('Initial commentsMap root: ' + commentsMap.getRoot().toString());
              commentsMap.set(
                  Poseidon.hash([Field(target!.targetKey), commenterAddressAsField, commentContentID.hash()]),
                  restoredTargetState.hash()
              );
              console.log('Latest commentsMap root: ' + commentsMap.getRoot().toString());
            }
          }
          tries++;
        }
      }
  } else if (provingTurn === provingRepostDeletions) {

    const pendingRepostDeletions = await prisma.repostDeletions.findMany({
      take: 1,
      orderBy: {
          allDeletionsCounter: 'asc'
      },
      where: {
          deletionBlockHeight: 0
      }
      });
      console.log('pendingRepostDeletions:');
      console.log(pendingRepostDeletions);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configReposts.url);
      const deletionBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(deletionBlockHeight);

      const currentAllRepostsCounter = await prisma.reposts.count();
    
      const transitionsAndProofs: {
        transition: RepostsTransition,
        proof: RepostsProof
      }[] = [];
    
      for (const pDeletion of pendingRepostDeletions) {

        const repost = await prisma.reposts.findUnique({
          where: {
            repostKey: pDeletion.targetKey
          }
        });

        const parent = await prisma.posts.findUnique({
          where: {
            postKey: repost!.targetKey
          }
        });

        const result = await proveRepostDeletion(
          parent,
          repost!.isTargetPost,
          repost!.targetKey,
          repost!.reposterAddress,
          repost!.allRepostsCounter,
          repost!.userRepostsCounter,
          repost!.targetRepostsCounter,
          repost!.repostBlockHeight,
          repost!.restorationBlockHeight,
          Field(repost!.repostKey),
          pDeletion.deletionSignature,
          Field(deletionBlockHeight),
          Field(currentAllRepostsCounter)
        );
    
        transitionsAndProofs.push(result);
      }

      if (transitionsAndProofs.length !== 0) {
        await updateRepostsOnChainState(transitionsAndProofs);
    
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allRepostsCounterFetch;
        let usersRepostsCountersFetch;
        let targetsRepostsCountersFetch;
        let repostsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allRepostsCounterFetch = await repostsContract.allRepostsCounter.fetch();
          console.log('allRepostsCounterFetch: ' + allRepostsCounterFetch?.toString());
          usersRepostsCountersFetch = await repostsContract.usersRepostsCounters.fetch();
          console.log('usersRepostsCountersFetch: ' + usersRepostsCountersFetch?.toString());
          targetsRepostsCountersFetch = await repostsContract.targetsRepostsCounters.fetch();
          console.log('targetsRepostsCountersFetch: ' + targetsRepostsCountersFetch?.toString());
          repostsFetch = await repostsContract.reposts.fetch();
          console.log('repostsFetch: ' + repostsFetch?.toString());
    
          console.log(Field(repostsContext.totalNumberOfReposts).toString());
          console.log(usersRepostsCountersMap.getRoot().toString());
          console.log(targetsRepostsCountersMap.getRoot().toString());
          console.log(repostsMap.getRoot().toString());
    
          console.log(allRepostsCounterFetch?.equals(Field(repostsContext.totalNumberOfReposts)).toBoolean());
          console.log(usersRepostsCountersFetch?.equals(usersRepostsCountersMap.getRoot()).toBoolean());
          console.log(targetsRepostsCountersFetch?.equals(targetsRepostsCountersMap.getRoot()).toBoolean());
          console.log(repostsFetch?.equals(repostsMap.getRoot()).toBoolean());
    
          if (allRepostsCounterFetch?.equals(Field(repostsContext.totalNumberOfReposts)).toBoolean()
          && usersRepostsCountersFetch?.equals(usersRepostsCountersMap.getRoot()).toBoolean()
          && targetsRepostsCountersFetch?.equals(targetsRepostsCountersMap.getRoot()).toBoolean()
          && repostsFetch?.equals(repostsMap.getRoot()).toBoolean()) {
            for (const pDeletion of pendingRepostDeletions) {
              await prisma.reposts.update({
                  where: {
                    repostKey: pDeletion.targetKey
                  },
                  data: {
                    deletionBlockHeight: deletionBlockHeight
                  }
              });

              await prisma.repostDeletions.update({
                where: {
                  allDeletionsCounter: pDeletion.allDeletionsCounter
                },
                data: {
                  deletionBlockHeight: deletionBlockHeight
                }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {

            for (const pDeletion of pendingRepostDeletions) {

              const target = await prisma.reposts.findUnique({
                where: {
                  repostKey: pDeletion.targetKey
                }
              });

              const reposterAddress = PublicKey.fromBase58(target!.reposterAddress);
              const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());
        
              const restoredTargetState = new RepostState({
                isTargetPost: Bool(target!.isTargetPost),
                targetKey: Field(target!.targetKey),
                reposterAddress: reposterAddress,
                allRepostsCounter: Field(target!.allRepostsCounter),
                userRepostsCounter: Field(target!.userRepostsCounter),
                repostBlockHeight: Field(target!.repostBlockHeight),
                targetRepostsCounter: Field(target!.targetRepostsCounter),
                deletionBlockHeight: Field(target!.deletionBlockHeight),
                restorationBlockHeight: Field(target!.restorationBlockHeight)
              });

              console.log('Initial repostsMap root: ' + repostsMap.getRoot().toString());
              repostsMap.set(
                  Poseidon.hash([Field(target!.targetKey), reposterAddressAsField]),
                  restoredTargetState.hash()
              );
              console.log('Latest repostsMap root: ' + repostsMap.getRoot().toString());
            }
          }
          tries++;
        }
      }
  } else if (provingTurn === provingRepostRestorations) {

    const pendingRepostRestorations = await prisma.repostRestorations.findMany({
      take: 1,
      orderBy: {
          allRestorationsCounter: 'asc'
      },
      where: {
          restorationBlockHeight: 0
      }
      });
      console.log('pendingRepostRestorations:');
      console.log(pendingRepostRestorations);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configReposts.url);
      const restorationBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(restorationBlockHeight);

      const currentAllRepostsCounter = await prisma.reposts.count();
    
      const transitionsAndProofs: {
        transition: RepostsTransition,
        proof: RepostsProof
      }[] = [];
    
      for (const pRestoration of pendingRepostRestorations) {

        const repost = await prisma.reposts.findUnique({
          where: {
            repostKey: pRestoration.targetKey
          }
        });

        const parent = await prisma.posts.findUnique({
          where: {
            postKey: repost!.targetKey
          }
        });

        const result = await proveRepostRestoration(
          parent,
          repost!.isTargetPost,
          repost!.targetKey,
          repost!.reposterAddress,
          repost!.allRepostsCounter,
          repost!.userRepostsCounter,
          repost!.targetRepostsCounter,
          repost!.repostBlockHeight,
          repost!.deletionBlockHeight,
          repost!.restorationBlockHeight,
          Field(repost!.repostKey),
          pRestoration.restorationSignature,
          Field(restorationBlockHeight),
          Field(currentAllRepostsCounter)
        );
    
        transitionsAndProofs.push(result);
      }

      if (transitionsAndProofs.length !== 0) {
        await updateRepostsOnChainState(transitionsAndProofs);
    
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allRepostsCounterFetch;
        let usersRepostsCountersFetch;
        let targetsRepostsCountersFetch;
        let repostsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allRepostsCounterFetch = await repostsContract.allRepostsCounter.fetch();
          console.log('allRepostsCounterFetch: ' + allRepostsCounterFetch?.toString());
          usersRepostsCountersFetch = await repostsContract.usersRepostsCounters.fetch();
          console.log('usersRepostsCountersFetch: ' + usersRepostsCountersFetch?.toString());
          targetsRepostsCountersFetch = await repostsContract.targetsRepostsCounters.fetch();
          console.log('targetsRepostsCountersFetch: ' + targetsRepostsCountersFetch?.toString());
          repostsFetch = await repostsContract.reposts.fetch();
          console.log('repostsFetch: ' + repostsFetch?.toString());
    
          console.log(Field(repostsContext.totalNumberOfReposts).toString());
          console.log(usersRepostsCountersMap.getRoot().toString());
          console.log(targetsRepostsCountersMap.getRoot().toString());
          console.log(repostsMap.getRoot().toString());
    
          console.log(allRepostsCounterFetch?.equals(Field(repostsContext.totalNumberOfReposts)).toBoolean());
          console.log(usersRepostsCountersFetch?.equals(usersRepostsCountersMap.getRoot()).toBoolean());
          console.log(targetsRepostsCountersFetch?.equals(targetsRepostsCountersMap.getRoot()).toBoolean());
          console.log(repostsFetch?.equals(repostsMap.getRoot()).toBoolean());
    
          if (allRepostsCounterFetch?.equals(Field(repostsContext.totalNumberOfReposts)).toBoolean()
          && usersRepostsCountersFetch?.equals(usersRepostsCountersMap.getRoot()).toBoolean()
          && targetsRepostsCountersFetch?.equals(targetsRepostsCountersMap.getRoot()).toBoolean()
          && repostsFetch?.equals(repostsMap.getRoot()).toBoolean()) {
            for (const pRestoration of pendingRepostRestorations) {
              await prisma.reposts.update({
                  where: {
                    repostKey: pRestoration.targetKey
                  },
                  data: {
                    deletionBlockHeight: 0,
                    restorationBlockHeight: restorationBlockHeight
                  }
              });

              await prisma.repostRestorations.update({
                where: {
                  allRestorationsCounter: pRestoration.allRestorationsCounter
                },
                data: {
                  restorationBlockHeight: restorationBlockHeight
                }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {

            for (const pRestoration of pendingRepostRestorations) {

              const target = await prisma.reposts.findUnique({
                where: {
                  repostKey: pRestoration.targetKey
                }
              });

              const reposterAddress = PublicKey.fromBase58(target!.reposterAddress);
              const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());
        
              const restoredTargetState = new RepostState({
                isTargetPost: Bool(target!.isTargetPost),
                targetKey: Field(target!.targetKey),
                reposterAddress: reposterAddress,
                allRepostsCounter: Field(target!.allRepostsCounter),
                userRepostsCounter: Field(target!.userRepostsCounter),
                repostBlockHeight: Field(target!.repostBlockHeight),
                targetRepostsCounter: Field(target!.targetRepostsCounter),
                deletionBlockHeight: Field(target!.deletionBlockHeight),
                restorationBlockHeight: Field(target!.restorationBlockHeight)
              });

              console.log('Initial repostsMap root: ' + repostsMap.getRoot().toString());
              repostsMap.set(
                  Poseidon.hash([Field(target!.targetKey), reposterAddressAsField]),
                  restoredTargetState.hash()
              );
              console.log('Latest repostsMap root: ' + repostsMap.getRoot().toString());
            }
          }
          tries++;
        }
      }
  } else if (provingTurn === provingReactionDeletions) {

    const pendingReactionDeletions = await prisma.reactionDeletions.findMany({
      take: 3,
      orderBy: {
          allDeletionsCounter: 'asc'
      },
      where: {
          deletionBlockHeight: 0
      }
      });
      console.log('pendingReactionDeletions:');
      console.log(pendingReactionDeletions);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configReactions.url);
      const deletionBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(deletionBlockHeight);

      const currentAllReactionsCounter = await prisma.reactions.count();

      const proveReactionDeletionInputs: {
        transition: string,
        signature: string,
        targets: string,
        postState: string,
        targetWitness: string,
        currentAllReactionsCounter: string,
        usersReactionsCounters: string,
        targetsReactionsCounters: string,
        initialReactions: string,
        latestReactions: string,
        initialReactionState: string,
        reactionWitness: string,
        deletionBlockHeight: string
      }[] = [];
    
      for (const pDeletion of pendingReactionDeletions) {

        const reaction = await prisma.reactions.findUnique({
          where: {
            reactionKey: pDeletion.targetKey
          }
        });

        const parent = await prisma.posts.findUnique({
          where: {
            postKey: reaction!.targetKey
          }
        });

        const result = await generateReactionDeletionInputs(
          parent,
          reaction!.isTargetPost,
          reaction!.targetKey,
          reaction!.reactorAddress,
          reaction!.reactionCodePoint,
          reaction!.allReactionsCounter,
          reaction!.userReactionsCounter,
          reaction!.targetReactionsCounter,
          reaction!.reactionBlockHeight,
          reaction!.restorationBlockHeight,
          Field(reaction!.reactionKey),
          pDeletion.deletionSignature,
          Field(deletionBlockHeight),
          Field(currentAllReactionsCounter)
        );
    
        proveReactionDeletionInputs.push(result);
      }

      const jobsPromises: Promise<any>[] = [];

      for (const proveReactionDeletionInput of proveReactionDeletionInputs) {
        const job = await reactionDeletionsQueue.add(
          `job`,
          { proveReactionDeletionInput: proveReactionDeletionInput }
        );
        jobsPromises.push(job.waitUntilFinished(reactionDeletionsQueueEvents));
      }
  
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
    
      const transitionsAndProofs: {
        transition: ReactionsTransition,
        proof: ReactionsProof
      }[] = [];
    
      transitionsAndProofsAsStrings.forEach(transitionAndProof => {
        transitionsAndProofs.push({
          transition: ReactionsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: ReactionsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      });
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);

      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
        await updateReactionsOnChainState(transitionsAndProofs);
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allReactionsCounterFetch;
        let usersReactionsCountersFetch;
        let targetsReactionsCountersFetch;
        let reactionsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allReactionsCounterFetch = await reactionsContract.allReactionsCounter.fetch();
          console.log('allReactionsCounterFetch: ' + allReactionsCounterFetch?.toString());
          usersReactionsCountersFetch = await reactionsContract.usersReactionsCounters.fetch();
          console.log('usersReactionsCountersFetch: ' + usersReactionsCountersFetch?.toString());
          targetsReactionsCountersFetch = await reactionsContract.targetsReactionsCounters.fetch();
          console.log('targetsReactionsCountersFetch: ' + targetsReactionsCountersFetch?.toString());
          reactionsFetch = await reactionsContract.reactions.fetch();
          console.log('reactionsFetch: ' + reactionsFetch?.toString());
    
          console.log(Field(reactionsContext.totalNumberOfReactions).toString());
          console.log(usersReactionsCountersMap.getRoot().toString());
          console.log(targetsReactionsCountersMap.getRoot().toString());
          console.log(reactionsMap.getRoot().toString());
    
          console.log(allReactionsCounterFetch?.equals(Field(reactionsContext.totalNumberOfReactions)).toBoolean());
          console.log(usersReactionsCountersFetch?.equals(usersReactionsCountersMap.getRoot()).toBoolean());
          console.log(targetsReactionsCountersFetch?.equals(targetsReactionsCountersMap.getRoot()).toBoolean());
          console.log(reactionsFetch?.equals(reactionsMap.getRoot()).toBoolean());
    
          if (allReactionsCounterFetch?.equals(Field(reactionsContext.totalNumberOfReactions)).toBoolean()
          && usersReactionsCountersFetch?.equals(usersReactionsCountersMap.getRoot()).toBoolean()
          && targetsReactionsCountersFetch?.equals(targetsReactionsCountersMap.getRoot()).toBoolean()
          && reactionsFetch?.equals(reactionsMap.getRoot()).toBoolean()) {
            for (const pDeletion of pendingReactionDeletions) {
              await prisma.reactions.update({
                  where: {
                    reactionKey: pDeletion.targetKey
                  },
                  data: {
                    deletionBlockHeight: deletionBlockHeight
                  }
              });

              await prisma.reactionDeletions.update({
                where: {
                  allDeletionsCounter: pDeletion.allDeletionsCounter
                },
                data: {
                  deletionBlockHeight: deletionBlockHeight
                }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {

            for (const pDeletion of pendingReactionDeletions) {

              const target = await prisma.reactions.findUnique({
                where: {
                  reactionKey: pDeletion.targetKey
                }
              });

              const reactorAddress = PublicKey.fromBase58(target!.reactorAddress);
              const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
              const reactionCodePointAsField = Field(target!.reactionCodePoint);
        
              const restoredTargetState = new ReactionState({
                isTargetPost: Bool(target!.isTargetPost),
                targetKey: Field(target!.targetKey),
                reactorAddress: reactorAddress,
                reactionCodePoint: reactionCodePointAsField,
                allReactionsCounter: Field(target!.allReactionsCounter),
                userReactionsCounter: Field(target!.userReactionsCounter),
                reactionBlockHeight: Field(target!.reactionBlockHeight),
                targetReactionsCounter: Field(target!.targetReactionsCounter),
                deletionBlockHeight: Field(target!.deletionBlockHeight),
                restorationBlockHeight: Field(target!.restorationBlockHeight)
              });

              console.log('Initial reactionsMap root: ' + reactionsMap.getRoot().toString());
              reactionsMap.set(
                  Poseidon.hash([Field(target!.targetKey), reactorAddressAsField, reactionCodePointAsField]),
                  restoredTargetState.hash()
              );
              console.log('Latest reactionsMap root: ' + reactionsMap.getRoot().toString());
            }
          }
          tries++;
        }
      }
  } else if (provingTurn === provingReactionRestorations) {

    const pendingReactionRestorations = await prisma.reactionRestorations.findMany({
      take: 3,
      orderBy: {
          allRestorationsCounter: 'asc'
      },
      where: {
          restorationBlockHeight: 0
      }
      });
      console.log('pendingReactionRestorations:');
      console.log(pendingReactionRestorations);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configReactions.url);
      const restorationBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(restorationBlockHeight);

      const currentAllReactionsCounter = await prisma.reactions.count();

      const proveReactionRestorationInputs: {
        transition: string,
        signature: string,
        targets: string,
        postState: string,
        targetWitness: string,
        currentAllReactionsCounter: string,
        usersReactionsCounters: string,
        targetsReactionsCounters: string,
        initialReactions: string,
        latestReactions: string,
        initialReactionState: string,
        reactionWitness: string,
        restorationBlockHeight: string
      }[] = [];
    
      for (const pRestoration of pendingReactionRestorations) {

        const reaction = await prisma.reactions.findUnique({
          where: {
            reactionKey: pRestoration.targetKey
          }
        });

        const parent = await prisma.posts.findUnique({
          where: {
            postKey: reaction!.targetKey
          }
        });

        const result = await generateReactionRestorationInputs(
          parent,
          reaction!.isTargetPost,
          reaction!.targetKey,
          reaction!.reactorAddress,
          reaction!.reactionCodePoint,
          reaction!.allReactionsCounter,
          reaction!.userReactionsCounter,
          reaction!.targetReactionsCounter,
          reaction!.reactionBlockHeight,
          reaction!.deletionBlockHeight,
          reaction!.restorationBlockHeight,
          Field(reaction!.reactionKey),
          pRestoration.restorationSignature,
          Field(restorationBlockHeight),
          Field(currentAllReactionsCounter)
        );
    
        proveReactionRestorationInputs.push(result);
      }

      const jobsPromises: Promise<any>[] = [];

      for (const proveReactionRestorationInput of proveReactionRestorationInputs) {
        const job = await reactionRestorationsQueue.add(
          `job`,
          { proveReactionRestorationInput: proveReactionRestorationInput }
        );
        jobsPromises.push(job.waitUntilFinished(reactionRestorationsQueueEvents));
      }
  
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
    
      const transitionsAndProofs: {
        transition: ReactionsTransition,
        proof: ReactionsProof
      }[] = [];
    
      transitionsAndProofsAsStrings.forEach(transitionAndProof => {
        transitionsAndProofs.push({
          transition: ReactionsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: ReactionsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      });
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);

      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
        await updateReactionsOnChainState(transitionsAndProofs);
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allReactionsCounterFetch;
        let usersReactionsCountersFetch;
        let targetsReactionsCountersFetch;
        let reactionsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allReactionsCounterFetch = await reactionsContract.allReactionsCounter.fetch();
          console.log('allReactionsCounterFetch: ' + allReactionsCounterFetch?.toString());
          usersReactionsCountersFetch = await reactionsContract.usersReactionsCounters.fetch();
          console.log('usersReactionsCountersFetch: ' + usersReactionsCountersFetch?.toString());
          targetsReactionsCountersFetch = await reactionsContract.targetsReactionsCounters.fetch();
          console.log('targetsReactionsCountersFetch: ' + targetsReactionsCountersFetch?.toString());
          reactionsFetch = await reactionsContract.reactions.fetch();
          console.log('reactionsFetch: ' + reactionsFetch?.toString());
    
          console.log(Field(reactionsContext.totalNumberOfReactions).toString());
          console.log(usersReactionsCountersMap.getRoot().toString());
          console.log(targetsReactionsCountersMap.getRoot().toString());
          console.log(reactionsMap.getRoot().toString());
    
          console.log(allReactionsCounterFetch?.equals(Field(reactionsContext.totalNumberOfReactions)).toBoolean());
          console.log(usersReactionsCountersFetch?.equals(usersReactionsCountersMap.getRoot()).toBoolean());
          console.log(targetsReactionsCountersFetch?.equals(targetsReactionsCountersMap.getRoot()).toBoolean());
          console.log(reactionsFetch?.equals(reactionsMap.getRoot()).toBoolean());
    
          if (allReactionsCounterFetch?.equals(Field(reactionsContext.totalNumberOfReactions)).toBoolean()
          && usersReactionsCountersFetch?.equals(usersReactionsCountersMap.getRoot()).toBoolean()
          && targetsReactionsCountersFetch?.equals(targetsReactionsCountersMap.getRoot()).toBoolean()
          && reactionsFetch?.equals(reactionsMap.getRoot()).toBoolean()) {
            for (const pRestoration of pendingReactionRestorations) {
              await prisma.reactions.update({
                  where: {
                    reactionKey: pRestoration.targetKey
                  },
                  data: {
                    deletionBlockHeight: 0,
                    restorationBlockHeight: restorationBlockHeight
                  }
              });

              await prisma.reactionRestorations.update({
                where: {
                  allRestorationsCounter: pRestoration.allRestorationsCounter
                },
                data: {
                  restorationBlockHeight: restorationBlockHeight
                }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {

            for (const pRestoration of pendingReactionRestorations) {

              const target = await prisma.reactions.findUnique({
                where: {
                  reactionKey: pRestoration.targetKey
                }
              });

              const reactorAddress = PublicKey.fromBase58(target!.reactorAddress);
              const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
              const reactionCodePointAsField = Field(target!.reactionCodePoint);
        
              const restoredTargetState = new ReactionState({
                isTargetPost: Bool(target!.isTargetPost),
                targetKey: Field(target!.targetKey),
                reactorAddress: reactorAddress,
                reactionCodePoint: reactionCodePointAsField,
                allReactionsCounter: Field(target!.allReactionsCounter),
                userReactionsCounter: Field(target!.userReactionsCounter),
                reactionBlockHeight: Field(target!.reactionBlockHeight),
                targetReactionsCounter: Field(target!.targetReactionsCounter),
                deletionBlockHeight: Field(target!.deletionBlockHeight),
                restorationBlockHeight: Field(target!.restorationBlockHeight)
              });

              console.log('Initial reactionsMap root: ' + reactionsMap.getRoot().toString());
              reactionsMap.set(
                  Poseidon.hash([Field(target!.targetKey), reactorAddressAsField, reactionCodePointAsField]),
                  restoredTargetState.hash()
              );
              console.log('Latest reactionsMap root: ' + reactionsMap.getRoot().toString());
            }
          }
          tries++;
        }
      }
  }
  provingTurn++;
  if (provingTurn > provingReactionRestorations) {
    provingTurn = 0;
    console.log('Pause to wait for new actions before running loop again...');
    await delay(10000);
  }
}

// ============================================================================

async function generateProvePostInputs(signatureBase58: string, posterAddressBase58: string,
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

      return {
        signature: signatureBase58,
        transition: JSON.stringify(transition),
        postState: JSON.stringify(postState),
        initialUsersPostsCounters: initialUsersPostsCounters.toString(),
        latestUsersPostsCounters: latestUsersPostsCounters.toString(),
        initialPosts: initialPosts.toString(),
        latestPosts: latestPosts.toString(),
        userPostsCounterWitness: JSON.stringify(userPostsCounterWitness.toJSON()),
        postWitness: JSON.stringify(postWitness.toJSON()),
      };
}
  
// ============================================================================

type PostTransitionAndProof = {
  transition: PostsTransition,
  proof: PostsProof
}

async function updatePostsOnChainState(transitionsAndProofs: PostTransitionAndProof[]) {

  async function mergeTransitionsAndProofs(tp1: PostTransitionAndProof, tp2: PostTransitionAndProof) {
    const mergedTransition = PostsTransition.mergePostsTransitions(tp1.transition, tp2.transition);
    const job = await mergingQueue.add(
      `job`,
      { mergedTransition: JSON.stringify(mergedTransition),
        proof1: JSON.stringify(tp1.proof.toJSON()),
        proof2: JSON.stringify(tp2.proof.toJSON())
      }
    );
    return job.waitUntilFinished(mergingQueueEvents);
  }

  async function recursiveMerge(transitionsAndProofs: PostTransitionAndProof[]): Promise<PostTransitionAndProof> {
      if (transitionsAndProofs.length === 1) {
          return transitionsAndProofs[0];
      }

      const mergedTransitionsAndProofs = [];
      for (let i = 0; i < transitionsAndProofs.length; i += 2) {
          if (i + 1 < transitionsAndProofs.length) {
            mergedTransitionsAndProofs.push(mergeTransitionsAndProofs(transitionsAndProofs[i], transitionsAndProofs[i+1]));
          } else {
            mergedTransitionsAndProofs.push(Promise.resolve({
              transition: JSON.stringify(transitionsAndProofs[i].transition),
              proof: JSON.stringify(transitionsAndProofs[i].proof.toJSON())
            }));
          }
      }
      const processedMergedTransitionsAndProofs:{
        transition: string;
        proof: string;
      }[] = await Promise.all(mergedTransitionsAndProofs);
      const processedMergedTransitionsAndProofsCasted: PostTransitionAndProof[] = [];
      processedMergedTransitionsAndProofs.forEach(transitionAndProof => {
        processedMergedTransitionsAndProofsCasted.push({
          transition: PostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: PostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      });
      return recursiveMerge(processedMergedTransitionsAndProofsCasted);
  }

  const result = await recursiveMerge(transitionsAndProofs);
  
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    () => {
      postsContract.update(result.proof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn !== undefined) {
    console.log(`https://minascan.io/berkeley/tx/${sentTxn.hash}`);
  }

  return sentTxn;
}

// ============================================================================

async function generateProveReactionInputs(isTargetPost: boolean, targetKey: string,
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

  return {
    transition: JSON.stringify(transition),
    signature: signatureBase58,
    targets: postsMap.getRoot().toString(),
    postState: JSON.stringify(postState),
    targetWitness: JSON.stringify(targetWitness.toJSON()),
    reactionState: JSON.stringify(reactionState),
    initialUsersReactionsCounters: initialUsersReactionsCounters.toString(),
    latestUsersReactionsCounters: latestUsersReactionsCounters.toString(),
    userReactionsCounterWitness: JSON.stringify(userReactionsCounterWitness.toJSON()),
    initialTargetsReactionsCounters: initialTargetsReactionsCounters.toString(),
    latestTargetsReactionsCounters: latestTargetsReactionsCounters.toString(),
    targetReactionsCounterWitness: JSON.stringify(targetReactionsCounterWitness.toJSON()),
    initialReactions: initialReactions.toString(),
    latestReactions: latestReactions.toString(),
    reactionWitness: JSON.stringify(reactionWitness.toJSON())
  }
}

// ============================================================================

type ReactionTransitionAndProof = {
  transition: ReactionsTransition,
  proof: ReactionsProof
}

async function updateReactionsOnChainState(transitionsAndProofs: ReactionTransitionAndProof[]) {

  async function mergeTransitionsAndProofs(tp1: ReactionTransitionAndProof, tp2: ReactionTransitionAndProof) {
    const mergedTransition = ReactionsTransition.mergeReactionsTransitions(tp1.transition, tp2.transition);
    const job = await mergingReactionsQueue.add(
      `job`,
      { mergedTransition: JSON.stringify(mergedTransition),
        proof1: JSON.stringify(tp1.proof.toJSON()),
        proof2: JSON.stringify(tp2.proof.toJSON())
      }
    );
    return job.waitUntilFinished(mergingReactionsQueueEvents);
  }

  async function recursiveMerge(transitionsAndProofs: ReactionTransitionAndProof[]): Promise<ReactionTransitionAndProof> {
      if (transitionsAndProofs.length === 1) {
          return transitionsAndProofs[0];
      }

      const mergedTransitionsAndProofs = [];
      for (let i = 0; i < transitionsAndProofs.length; i += 2) {
          if (i + 1 < transitionsAndProofs.length) {
            mergedTransitionsAndProofs.push(mergeTransitionsAndProofs(transitionsAndProofs[i], transitionsAndProofs[i+1]));
          } else {
            mergedTransitionsAndProofs.push(Promise.resolve({
              transition: JSON.stringify(transitionsAndProofs[i].transition),
              proof: JSON.stringify(transitionsAndProofs[i].proof.toJSON())
            }));
          }
      }
      const processedMergedTransitionsAndProofs:{
        transition: string;
        proof: string;
      }[] = await Promise.all(mergedTransitionsAndProofs);
      const processedMergedTransitionsAndProofsCasted: ReactionTransitionAndProof[] = [];
      processedMergedTransitionsAndProofs.forEach(transitionAndProof => {
        processedMergedTransitionsAndProofsCasted.push({
          transition: ReactionsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: ReactionsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      });
      return recursiveMerge(processedMergedTransitionsAndProofsCasted);
  }

  const result = await recursiveMerge(transitionsAndProofs);
  
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    () => {
      reactionsContract.update(result.proof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn !== undefined) {
    console.log(`https://minascan.io/berkeley/tx/${sentTxn.hash}`);
  }

  return sentTxn;
}

// ============================================================================

async function generateProveCommentInputs(isTargetPost: boolean, targetKey: string,
  commenterAddressBase58: string, commentContentID: string,
  allCommentsCounter: bigint, userCommentsCounter: bigint,
  targetCommentsCounter: bigint, commentBlockHeight: bigint,
  deletionBlockHeight: bigint, restorationBlockHeight: bigint,
  signatureBase58: string) {

  const commenterAddress = PublicKey.fromBase58(commenterAddressBase58);
  const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
  const commentContentIDAsCS = CircuitString.fromString(commentContentID);
  const commentContentIDAsField = commentContentIDAsCS.hash();
  const targetKeyAsField = Field(targetKey);
  const signature = Signature.fromBase58(signatureBase58);

  const commentState = new CommentState({
    isTargetPost: Bool(isTargetPost),
    targetKey: targetKeyAsField,
    commenterAddress: commenterAddress,
    commentContentID: commentContentIDAsCS,
    allCommentsCounter: Field(allCommentsCounter),
    userCommentsCounter: Field(userCommentsCounter),
    targetCommentsCounter: Field(targetCommentsCounter),
    commentBlockHeight: Field(commentBlockHeight),
    deletionBlockHeight: Field(deletionBlockHeight),
    restorationBlockHeight: Field(restorationBlockHeight)
  });

  const initialUsersCommentsCounters = usersCommentsCountersMap.getRoot();
  const userCommentsCounterWitness = usersCommentsCountersMap.getWitness(commenterAddressAsField);
  usersCommentsCountersMap.set(commenterAddressAsField, commentState.userCommentsCounter);
  const latestUsersCommentsCounters = usersCommentsCountersMap.getRoot();

  const initialTargetsCommentsCounters = targetsCommentsCountersMap.getRoot();
  const targetCommentsCounterWitness = targetsCommentsCountersMap.getWitness(targetKeyAsField);
  targetsCommentsCountersMap.set(targetKeyAsField, commentState.targetCommentsCounter);
  const latestTargetsCommentsCounters = targetsCommentsCountersMap.getRoot();

  const initialComments = commentsMap.getRoot();
  const commentKey = Poseidon.hash([targetKeyAsField, commenterAddressAsField, commentContentIDAsField]);
  const commentWitness = commentsMap.getWitness(commentKey);
  commentsMap.set(commentKey, commentState.hash());
  const latestComments = commentsMap.getRoot();

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

  const transition = CommentsTransition.createCommentPublishingTransition(
    signature,
    postsMap.getRoot(),
    postState,
    targetWitness,
    commentState.allCommentsCounter.sub(1),
    initialUsersCommentsCounters,
    latestUsersCommentsCounters,
    commentState.userCommentsCounter.sub(1),
    userCommentsCounterWitness,
    initialTargetsCommentsCounters,
    latestTargetsCommentsCounters,
    commentState.targetCommentsCounter.sub(1),
    targetCommentsCounterWitness,
    initialComments,
    latestComments,
    commentWitness,
    commentState
  );
  console.log('Transition created');

  return {
    transition: JSON.stringify(transition),
    signature: signatureBase58,
    targets: postsMap.getRoot().toString(),
    postState: JSON.stringify(postState),
    targetWitness: JSON.stringify(targetWitness.toJSON()),
    commentState: JSON.stringify(commentState),
    initialUsersCommentsCounters: initialUsersCommentsCounters.toString(),
    latestUsersCommentsCounters: latestUsersCommentsCounters.toString(),
    userCommentsCounterWitness: JSON.stringify(userCommentsCounterWitness.toJSON()),
    initialTargetsCommentsCounters: initialTargetsCommentsCounters.toString(),
    latestTargetsCommentsCounters: latestTargetsCommentsCounters.toString(),
    targetCommentsCounterWitness: JSON.stringify(targetCommentsCounterWitness.toJSON()),
    initialComments: initialComments.toString(),
    latestComments: latestComments.toString(),
    commentWitness: JSON.stringify(commentWitness.toJSON())
  }
}

// ============================================================================

type CommentTransitionAndProof = {
  transition: CommentsTransition,
  proof: CommentsProof
}

async function updateCommentsOnChainState(transitionsAndProofs: CommentTransitionAndProof[]) {

  async function mergeTransitionsAndProofs(tp1: CommentTransitionAndProof, tp2: CommentTransitionAndProof) {
    const mergedTransition = CommentsTransition.mergeCommentsTransitions(tp1.transition, tp2.transition);
    const job = await mergingCommentsQueue.add(
      `job`,
      { mergedTransition: JSON.stringify(mergedTransition),
        proof1: JSON.stringify(tp1.proof.toJSON()),
        proof2: JSON.stringify(tp2.proof.toJSON())
      }
    );
    return job.waitUntilFinished(mergingCommentsQueueEvents);
  }

  async function recursiveMerge(transitionsAndProofs: CommentTransitionAndProof[]): Promise<CommentTransitionAndProof> {
      if (transitionsAndProofs.length === 1) {
          return transitionsAndProofs[0];
      }

      const mergedTransitionsAndProofs = [];
      for (let i = 0; i < transitionsAndProofs.length; i += 2) {
          if (i + 1 < transitionsAndProofs.length) {
            mergedTransitionsAndProofs.push(mergeTransitionsAndProofs(transitionsAndProofs[i], transitionsAndProofs[i+1]));
          } else {
            mergedTransitionsAndProofs.push(Promise.resolve({
              transition: JSON.stringify(transitionsAndProofs[i].transition),
              proof: JSON.stringify(transitionsAndProofs[i].proof.toJSON())
            }));
          }
      }
      const processedMergedTransitionsAndProofs:{
        transition: string;
        proof: string;
      }[] = await Promise.all(mergedTransitionsAndProofs);
      const processedMergedTransitionsAndProofsCasted: CommentTransitionAndProof[] = [];
      processedMergedTransitionsAndProofs.forEach(transitionAndProof => {
        processedMergedTransitionsAndProofsCasted.push({
          transition: CommentsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: CommentsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      });
      return recursiveMerge(processedMergedTransitionsAndProofsCasted);
  }

  const result = await recursiveMerge(transitionsAndProofs);
  
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    () => {
      commentsContract.update(result.proof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn !== undefined) {
    console.log(`https://minascan.io/berkeley/tx/${sentTxn.hash}`);
  }

  return sentTxn;
}

// ============================================================================

async function proveRepost(isTargetPost: boolean, targetKey: string,
  reposterAddressBase58: string, allRepostsCounter: bigint,
  userRepostsCounter: bigint, targetRepostsCounter: bigint,
  repostBlockHeight: bigint, deletionBlockHeight: bigint,
  restorationBlockHeight: bigint, signatureBase58: string) {

  const reposterAddress = PublicKey.fromBase58(reposterAddressBase58);
  const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());
  const targetKeyAsField = Field(targetKey);
  const signature = Signature.fromBase58(signatureBase58);

  const repostState = new RepostState({
    isTargetPost: Bool(isTargetPost),
    targetKey: targetKeyAsField,
    reposterAddress: reposterAddress,
    allRepostsCounter: Field(allRepostsCounter),
    userRepostsCounter: Field(userRepostsCounter),
    targetRepostsCounter: Field(targetRepostsCounter),
    repostBlockHeight: Field(repostBlockHeight),
    deletionBlockHeight: Field(deletionBlockHeight),
    restorationBlockHeight: Field(restorationBlockHeight)
  });

  const initialUsersRepostsCounters = usersRepostsCountersMap.getRoot();
  const userRepostsCounterWitness = usersRepostsCountersMap.getWitness(reposterAddressAsField);
  usersRepostsCountersMap.set(reposterAddressAsField, repostState.userRepostsCounter);
  const latestUsersRepostsCounters = usersRepostsCountersMap.getRoot();

  const initialTargetsRepostsCounters = targetsRepostsCountersMap.getRoot();
  const targetRepostsCounterWitness = targetsRepostsCountersMap.getWitness(targetKeyAsField);
  targetsRepostsCountersMap.set(targetKeyAsField, repostState.targetRepostsCounter);
  const latestTargetsRepostsCounters = targetsRepostsCountersMap.getRoot();

  const initialReposts = repostsMap.getRoot();
  const repostKey = Poseidon.hash([targetKeyAsField, reposterAddressAsField]);
  const repostWitness = repostsMap.getWitness(repostKey);
  repostsMap.set(repostKey, repostState.hash());
  const latestReposts = repostsMap.getRoot();

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

  const transition = RepostsTransition.createRepostPublishingTransition(
    signature,
    postsMap.getRoot(),
    postState,
    targetWitness,
    repostState.allRepostsCounter.sub(1),
    initialUsersRepostsCounters,
    latestUsersRepostsCounters,
    repostState.userRepostsCounter.sub(1),
    userRepostsCounterWitness,
    initialTargetsRepostsCounters,
    latestTargetsRepostsCounters,
    repostState.targetRepostsCounter.sub(1),
    targetRepostsCounterWitness,
    initialReposts,
    latestReposts,
    repostWitness,
    repostState
  );
  console.log('Transition created');
  
  const proof = await Reposts.proveRepostPublishingTransition(
    transition,
    signature,
    postsMap.getRoot(),
    postState,
    targetWitness,
    repostState.allRepostsCounter.sub(1),
    initialUsersRepostsCounters,
    latestUsersRepostsCounters,
    repostState.userRepostsCounter.sub(1),
    userRepostsCounterWitness,
    initialTargetsRepostsCounters,
    latestTargetsRepostsCounters,
    repostState.targetRepostsCounter.sub(1),
    targetRepostsCounterWitness,
    initialReposts,
    latestReposts,
    repostWitness,
    repostState
  );
  console.log('Proof created');

  return {transition: transition, proof: proof};
}

// ============================================================================

async function updateRepostsOnChainState(transitionsAndProofs: {
  transition: RepostsTransition,
  proof: RepostsProof
}[]) {
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    () => {
      repostsContract.update(transitionsAndProofs[0].proof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn !== undefined) {
    console.log(`https://minascan.io/berkeley/tx/${sentTxn.hash}`);
  }

  return sentTxn;
}

// ============================================================================

async function generatePostDeletionInputs(posterAddressBase58: string,
  postCID: string, allPostsCounter: bigint, userPostsCounter: bigint,
  postBlockHeight: bigint, restorationBlockHeight: bigint,
  postKey: Field, signatureBase58: string, deletionBlockHeight: Field,
  currentAllPostsCounter: Field) {

  const signature = Signature.fromBase58(signatureBase58);
  const posterAddress = PublicKey.fromBase58(posterAddressBase58);
  const postCIDAsCircuitString = CircuitString.fromString(postCID.toString());

      const initialPostState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(allPostsCounter),
        userPostsCounter: Field(userPostsCounter),
        postBlockHeight: Field(postBlockHeight),
        deletionBlockHeight: Field(0),
        restorationBlockHeight: Field(restorationBlockHeight)
      });

      const latestPostState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(allPostsCounter),
        userPostsCounter: Field(userPostsCounter),
        postBlockHeight: Field(postBlockHeight),
        deletionBlockHeight: deletionBlockHeight,
        restorationBlockHeight: Field(restorationBlockHeight)
      });

      const usersPostsCounters = usersPostsCountersMap.getRoot();

      const initialPosts = postsMap.getRoot();
      const postWitness = postsMap.getWitness(postKey);
      postsMap.set(postKey, latestPostState.hash());
      const latestPosts = postsMap.getRoot();

      const transition = PostsTransition.createPostDeletionTransition(
        signature,
        currentAllPostsCounter,
        usersPostsCounters,
        initialPosts,
        latestPosts,
        initialPostState,
        postWitness,
        deletionBlockHeight
      );
      console.log('Transition created');

      return {
        transition: JSON.stringify(transition),
        signature: signatureBase58,
        currentAllPostsCounter: currentAllPostsCounter.toString(),
        usersPostsCounters: usersPostsCounters.toString(),
        initialPosts: initialPosts.toString(),
        latestPosts: latestPosts.toString(),
        initialPostState: JSON.stringify(initialPostState),
        postWitness: JSON.stringify(postWitness.toJSON()),
        deletionBlockHeight: deletionBlockHeight.toString()
      }
}

// ============================================================================

async function generatePostRestorationInputs(posterAddressBase58: string,
  postCID: string, allPostsCounter: bigint, userPostsCounter: bigint,
  postBlockHeight: bigint, deletionBlockHeight: bigint, restorationBlockHeight: bigint,
  postKey: Field, signatureBase58: string, newRestorationBlockHeight: Field,
  currentAllPostsCounter: Field) {

  const signature = Signature.fromBase58(signatureBase58);
  const posterAddress = PublicKey.fromBase58(posterAddressBase58);
  const postCIDAsCircuitString = CircuitString.fromString(postCID.toString());

      const initialPostState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(allPostsCounter),
        userPostsCounter: Field(userPostsCounter),
        postBlockHeight: Field(postBlockHeight),
        deletionBlockHeight: Field(deletionBlockHeight),
        restorationBlockHeight: Field(restorationBlockHeight)
      });

      const latestPostState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(allPostsCounter),
        userPostsCounter: Field(userPostsCounter),
        postBlockHeight: Field(postBlockHeight),
        deletionBlockHeight: Field(0),
        restorationBlockHeight: newRestorationBlockHeight
      });

      const usersPostsCounters = usersPostsCountersMap.getRoot();

      const initialPosts = postsMap.getRoot();
      const postWitness = postsMap.getWitness(postKey);
      postsMap.set(postKey, latestPostState.hash());
      const latestPosts = postsMap.getRoot();

      const transition = PostsTransition.createPostRestorationTransition(
        signature,
        currentAllPostsCounter,
        usersPostsCounters,
        initialPosts,
        latestPosts,
        initialPostState,
        postWitness,
        newRestorationBlockHeight
      );
      console.log('Transition created');

      return {
        transition: JSON.stringify(transition),
        signature: signatureBase58,
        currentAllPostsCounter: currentAllPostsCounter.toString(),
        usersPostsCounters: usersPostsCounters.toString(),
        initialPosts: initialPosts.toString(),
        latestPosts: latestPosts.toString(),
        initialPostState: JSON.stringify(initialPostState),
        postWitness: JSON.stringify(postWitness.toJSON()),
        restorationBlockHeight: newRestorationBlockHeight.toString()
      }
}

// ============================================================================

async function generateProveCommentDeletionInputs(parent: {
    postKey: string;
    posterAddress: string;
    postContentID: string;
    allPostsCounter: bigint;
    userPostsCounter: bigint;
    postBlockHeight: bigint;
    deletionBlockHeight: bigint;
    restorationBlockHeight: bigint;
    postSignature: string;
  } | null,
  isTargetPost: boolean, targetKey: string, commenterAddressBase58: string,
  commentCID: string, allCommentsCounter: bigint, userCommentsCounter: bigint, targetCommentsCounter: bigint,
  commentBlockHeight: bigint, restorationBlockHeight: bigint, commentKey: Field, signatureBase58: string,
  deletionBlockHeight: Field, currentAllCommentsCounter: Field) {

  const signature = Signature.fromBase58(signatureBase58);
  const commenterAddress = PublicKey.fromBase58(commenterAddressBase58);
  const commentCIDAsCircuitString = CircuitString.fromString(commentCID.toString());

      const initialCommentState = new CommentState({
        isTargetPost: Bool(isTargetPost),
        targetKey: Field(targetKey),
        commenterAddress: commenterAddress,
        commentContentID: commentCIDAsCircuitString,
        allCommentsCounter: Field(allCommentsCounter),
        userCommentsCounter: Field(userCommentsCounter),
        targetCommentsCounter: Field(targetCommentsCounter),
        commentBlockHeight: Field(commentBlockHeight),
        deletionBlockHeight: Field(0),
        restorationBlockHeight: Field(restorationBlockHeight)
      });

      const latestCommentsState = new CommentState({
        isTargetPost: Bool(isTargetPost),
        targetKey: Field(targetKey),
        commenterAddress: commenterAddress,
        commentContentID: commentCIDAsCircuitString,
        allCommentsCounter: Field(allCommentsCounter),
        userCommentsCounter: Field(userCommentsCounter),
        targetCommentsCounter: Field(targetCommentsCounter),
        commentBlockHeight: Field(commentBlockHeight),
        deletionBlockHeight: deletionBlockHeight,
        restorationBlockHeight: Field(restorationBlockHeight)
      });

      const usersCommentsCounters = usersCommentsCountersMap.getRoot();
      const targetsCommentsCounters = targetsCommentsCountersMap.getRoot();

      const initialComments = commentsMap.getRoot();
      const commentWitness = commentsMap.getWitness(commentKey);
      commentsMap.set(commentKey, latestCommentsState.hash());
      const latestComments = commentsMap.getRoot();

      const currentPosts = postsMap.getRoot();
      const parentState = new PostState({
        posterAddress: PublicKey.fromBase58(parent!.posterAddress),
        postContentID: CircuitString.fromString(parent!.postContentID),
        allPostsCounter: Field(parent!.allPostsCounter),
        userPostsCounter: Field(parent!.userPostsCounter),
        postBlockHeight: Field(parent!.postBlockHeight),
        deletionBlockHeight: Field(parent!.deletionBlockHeight),
        restorationBlockHeight: Field(parent!.restorationBlockHeight)
      });
      const parentWitness = postsMap.getWitness(Field(parent!.postKey));

      const transition = CommentsTransition.createCommentDeletionTransition(
        signature,
        currentPosts,
        parentState,
        parentWitness,
        currentAllCommentsCounter,
        usersCommentsCounters,
        targetsCommentsCounters,
        initialComments,
        latestComments,
        initialCommentState,
        commentWitness,
        deletionBlockHeight
      );
      console.log('Transition created');

      return {
        transition: JSON.stringify(transition),
        signature: signatureBase58,
        targets: currentPosts.toString(),
        postState: JSON.stringify(parentState),
        targetWitness: JSON.stringify(parentWitness.toJSON()),
        currentAllCommentsCounter: currentAllCommentsCounter.toString(),
        usersCommentsCounters: usersCommentsCounters.toString(),
        targetsCommentsCounters: targetsCommentsCounters.toString(),
        initialComments: initialComments.toString(),
        latestComments: latestComments.toString(),
        initialCommentState: JSON.stringify(initialCommentState),
        commentWitness: JSON.stringify(commentWitness.toJSON()),
        deletionBlockHeight: deletionBlockHeight.toString()
      }
}

// ============================================================================

async function proveCommentRestoration(parent: {
  postKey: string;
  posterAddress: string;
  postContentID: string;
  allPostsCounter: bigint;
  userPostsCounter: bigint;
  postBlockHeight: bigint;
  deletionBlockHeight: bigint;
  restorationBlockHeight: bigint;
  postSignature: string;
} | null,
isTargetPost: boolean, targetKey: string, commenterAddressBase58: string,
commentCID: string, allCommentsCounter: bigint, userCommentsCounter: bigint, targetCommentsCounter: bigint,
commentBlockHeight: bigint, deletionBlockHeight: bigint, restorationBlockHeight: bigint, commentKey: Field, signatureBase58: string,
newRestorationBlockHeight: Field, currentAllCommentsCounter: Field) {

const signature = Signature.fromBase58(signatureBase58);
const commenterAddress = PublicKey.fromBase58(commenterAddressBase58);
const commentCIDAsCircuitString = CircuitString.fromString(commentCID.toString());

    const initialCommentState = new CommentState({
      isTargetPost: Bool(isTargetPost),
      targetKey: Field(targetKey),
      commenterAddress: commenterAddress,
      commentContentID: commentCIDAsCircuitString,
      allCommentsCounter: Field(allCommentsCounter),
      userCommentsCounter: Field(userCommentsCounter),
      targetCommentsCounter: Field(targetCommentsCounter),
      commentBlockHeight: Field(commentBlockHeight),
      deletionBlockHeight: Field(deletionBlockHeight),
      restorationBlockHeight: Field(restorationBlockHeight)
    });

    const latestCommentsState = new CommentState({
      isTargetPost: Bool(isTargetPost),
      targetKey: Field(targetKey),
      commenterAddress: commenterAddress,
      commentContentID: commentCIDAsCircuitString,
      allCommentsCounter: Field(allCommentsCounter),
      userCommentsCounter: Field(userCommentsCounter),
      targetCommentsCounter: Field(targetCommentsCounter),
      commentBlockHeight: Field(commentBlockHeight),
      deletionBlockHeight: Field(0),
      restorationBlockHeight: newRestorationBlockHeight
    });

    const usersCommentsCounters = usersCommentsCountersMap.getRoot();
    const targetsCommentsCounters = targetsCommentsCountersMap.getRoot();

    const initialComments = commentsMap.getRoot();
    const commentWitness = commentsMap.getWitness(commentKey);
    commentsMap.set(commentKey, latestCommentsState.hash());
    const latestComments = commentsMap.getRoot();

    const currentPosts = postsMap.getRoot();
    const parentState = new PostState({
      posterAddress: PublicKey.fromBase58(parent!.posterAddress),
      postContentID: CircuitString.fromString(parent!.postContentID),
      allPostsCounter: Field(parent!.allPostsCounter),
      userPostsCounter: Field(parent!.userPostsCounter),
      postBlockHeight: Field(parent!.postBlockHeight),
      deletionBlockHeight: Field(parent!.deletionBlockHeight),
      restorationBlockHeight: Field(parent!.restorationBlockHeight)
    });
    const parentWitness = postsMap.getWitness(Field(parent!.postKey));

    const transition = CommentsTransition.createCommentRestorationTransition(
      signature,
      currentPosts,
      parentState,
      parentWitness,
      currentAllCommentsCounter,
      usersCommentsCounters,
      targetsCommentsCounters,
      initialComments,
      latestComments,
      initialCommentState,
      commentWitness,
      newRestorationBlockHeight
    );
    console.log('Transition created');
    
    const proof = await Comments.proveCommentRestorationTransition(
      transition,
      signature,
      currentPosts,
      parentState,
      parentWitness,
      currentAllCommentsCounter,
      usersCommentsCounters,
      targetsCommentsCounters,
      initialComments,
      latestComments,
      initialCommentState,
      commentWitness,
      newRestorationBlockHeight
    );
    console.log('Proof created');

    return {transition: transition, proof: proof};
}
  
// ============================================================================

async function proveRepostDeletion(parent: {
  postKey: string;
  posterAddress: string;
  postContentID: string;
  allPostsCounter: bigint;
  userPostsCounter: bigint;
  postBlockHeight: bigint;
  deletionBlockHeight: bigint;
  restorationBlockHeight: bigint;
  postSignature: string;
} | null,
isTargetPost: boolean, targetKey: string, reposterAddressBase58: string, allRepostsCounter: bigint,
userRepostsCounter: bigint, targetRepostsCounter: bigint, repostBlockHeight: bigint,
restorationBlockHeight: bigint, repostKey: Field, signatureBase58: string,
deletionBlockHeight: Field, currentAllRepostsCounter: Field) {

const signature = Signature.fromBase58(signatureBase58);
const reposterAddress = PublicKey.fromBase58(reposterAddressBase58);

    const initialRepostState = new RepostState({
      isTargetPost: Bool(isTargetPost),
      targetKey: Field(targetKey),
      reposterAddress: reposterAddress,
      allRepostsCounter: Field(allRepostsCounter),
      userRepostsCounter: Field(userRepostsCounter),
      targetRepostsCounter: Field(targetRepostsCounter),
      repostBlockHeight: Field(repostBlockHeight),
      deletionBlockHeight: Field(0),
      restorationBlockHeight: Field(restorationBlockHeight)
    });

    const latestRepostsState = new RepostState({
      isTargetPost: Bool(isTargetPost),
      targetKey: Field(targetKey),
      reposterAddress: reposterAddress,
      allRepostsCounter: Field(allRepostsCounter),
      userRepostsCounter: Field(userRepostsCounter),
      targetRepostsCounter: Field(targetRepostsCounter),
      repostBlockHeight: Field(repostBlockHeight),
      deletionBlockHeight: deletionBlockHeight,
      restorationBlockHeight: Field(restorationBlockHeight)
    });

    const usersRepostsCounters = usersRepostsCountersMap.getRoot();
    const targetsRepostsCounters = targetsRepostsCountersMap.getRoot();

    const initialReposts = repostsMap.getRoot();
    const repostWitness = repostsMap.getWitness(repostKey);
    repostsMap.set(repostKey, latestRepostsState.hash());
    const latestReposts = repostsMap.getRoot();

    const currentPosts = postsMap.getRoot();
    const parentState = new PostState({
      posterAddress: PublicKey.fromBase58(parent!.posterAddress),
      postContentID: CircuitString.fromString(parent!.postContentID),
      allPostsCounter: Field(parent!.allPostsCounter),
      userPostsCounter: Field(parent!.userPostsCounter),
      postBlockHeight: Field(parent!.postBlockHeight),
      deletionBlockHeight: Field(parent!.deletionBlockHeight),
      restorationBlockHeight: Field(parent!.restorationBlockHeight)
    });
    const parentWitness = postsMap.getWitness(Field(parent!.postKey));

    const transition = RepostsTransition.createRepostDeletionTransition(
      signature,
      currentPosts,
      parentState,
      parentWitness,
      currentAllRepostsCounter,
      usersRepostsCounters,
      targetsRepostsCounters,
      initialReposts,
      latestReposts,
      initialRepostState,
      repostWitness,
      deletionBlockHeight
    );
    console.log('Transition created');
    
    const proof = await Reposts.proveRepostDeletionTransition(
      transition,
      signature,
      currentPosts,
      parentState,
      parentWitness,
      currentAllRepostsCounter,
      usersRepostsCounters,
      targetsRepostsCounters,
      initialReposts,
      latestReposts,
      initialRepostState,
      repostWitness,
      deletionBlockHeight
    );
    console.log('Proof created');

    return {transition: transition, proof: proof};
}

// ============================================================================

async function proveRepostRestoration(parent: {
  postKey: string;
  posterAddress: string;
  postContentID: string;
  allPostsCounter: bigint;
  userPostsCounter: bigint;
  postBlockHeight: bigint;
  deletionBlockHeight: bigint;
  restorationBlockHeight: bigint;
  postSignature: string;
} | null,
isTargetPost: boolean, targetKey: string, reposterAddressBase58: string,
allRepostsCounter: bigint, userRepostsCounter: bigint, targetRepostsCounter: bigint, repostBlockHeight: bigint,
deletionBlockHeight: bigint, restorationBlockHeight: bigint, repostKey: Field,
signatureBase58: string, newRestorationBlockHeight: Field, currentAllRepostsCounter: Field) {

const signature = Signature.fromBase58(signatureBase58);
const reposterAddress = PublicKey.fromBase58(reposterAddressBase58);

    const initialRepostState = new RepostState({
      isTargetPost: Bool(isTargetPost),
      targetKey: Field(targetKey),
      reposterAddress: reposterAddress,
      allRepostsCounter: Field(allRepostsCounter),
      userRepostsCounter: Field(userRepostsCounter),
      targetRepostsCounter: Field(targetRepostsCounter),
      repostBlockHeight: Field(repostBlockHeight),
      deletionBlockHeight: Field(deletionBlockHeight),
      restorationBlockHeight: Field(restorationBlockHeight)
    });

    const latestRepostsState = new RepostState({
      isTargetPost: Bool(isTargetPost),
      targetKey: Field(targetKey),
      reposterAddress: reposterAddress,
      allRepostsCounter: Field(allRepostsCounter),
      userRepostsCounter: Field(userRepostsCounter),
      targetRepostsCounter: Field(targetRepostsCounter),
      repostBlockHeight: Field(repostBlockHeight),
      deletionBlockHeight: Field(0),
      restorationBlockHeight: newRestorationBlockHeight
    });

    const usersRepostsCounters = usersRepostsCountersMap.getRoot();
    const targetsRepostsCounters = targetsRepostsCountersMap.getRoot();

    const initialReposts = repostsMap.getRoot();
    const repostWitness = repostsMap.getWitness(repostKey);
    repostsMap.set(repostKey, latestRepostsState.hash());
    const latestReposts = repostsMap.getRoot();

    const currentPosts = postsMap.getRoot();
    const parentState = new PostState({
      posterAddress: PublicKey.fromBase58(parent!.posterAddress),
      postContentID: CircuitString.fromString(parent!.postContentID),
      allPostsCounter: Field(parent!.allPostsCounter),
      userPostsCounter: Field(parent!.userPostsCounter),
      postBlockHeight: Field(parent!.postBlockHeight),
      deletionBlockHeight: Field(parent!.deletionBlockHeight),
      restorationBlockHeight: Field(parent!.restorationBlockHeight)
    });
    const parentWitness = postsMap.getWitness(Field(parent!.postKey));

    const transition = RepostsTransition.createRepostRestorationTransition(
      signature,
      currentPosts,
      parentState,
      parentWitness,
      currentAllRepostsCounter,
      usersRepostsCounters,
      targetsRepostsCounters,
      initialReposts,
      latestReposts,
      initialRepostState,
      repostWitness,
      newRestorationBlockHeight
    );
    console.log('Transition created');
    
    const proof = await Reposts.proveRepostRestorationTransition(
      transition,
      signature,
      currentPosts,
      parentState,
      parentWitness,
      currentAllRepostsCounter,
      usersRepostsCounters,
      targetsRepostsCounters,
      initialReposts,
      latestReposts,
      initialRepostState,
      repostWitness,
      newRestorationBlockHeight
    );
    console.log('Proof created');

    return {transition: transition, proof: proof};
}

// ============================================================================

async function generateReactionDeletionInputs(parent: {
  postKey: string;
  posterAddress: string;
  postContentID: string;
  allPostsCounter: bigint;
  userPostsCounter: bigint;
  postBlockHeight: bigint;
  deletionBlockHeight: bigint;
  restorationBlockHeight: bigint;
  postSignature: string;
} | null,
isTargetPost: boolean, targetKey: string, reactorAddressBase58: string,
reactionCodePoint: bigint, allReactionsCounter: bigint, userReactionsCounter: bigint, targetReactionsCounter: bigint,
reactionBlockHeight: bigint, restorationBlockHeight: bigint, reactionKey: Field, signatureBase58: string,
deletionBlockHeight: Field, currentAllReactionsCounter: Field) {

const signature = Signature.fromBase58(signatureBase58);
const reactorAddress = PublicKey.fromBase58(reactorAddressBase58);
const reactionCodePointAsField = Field(reactionCodePoint);

    const initialReactionState = new ReactionState({
      isTargetPost: Bool(isTargetPost),
      targetKey: Field(targetKey),
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePointAsField,
      allReactionsCounter: Field(allReactionsCounter),
      userReactionsCounter: Field(userReactionsCounter),
      targetReactionsCounter: Field(targetReactionsCounter),
      reactionBlockHeight: Field(reactionBlockHeight),
      deletionBlockHeight: Field(0),
      restorationBlockHeight: Field(restorationBlockHeight)
    });

    const latestReactionsState = new ReactionState({
      isTargetPost: Bool(isTargetPost),
      targetKey: Field(targetKey),
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePointAsField,
      allReactionsCounter: Field(allReactionsCounter),
      userReactionsCounter: Field(userReactionsCounter),
      targetReactionsCounter: Field(targetReactionsCounter),
      reactionBlockHeight: Field(reactionBlockHeight),
      deletionBlockHeight: deletionBlockHeight,
      restorationBlockHeight: Field(restorationBlockHeight)
    });

    const usersReactionsCounters = usersReactionsCountersMap.getRoot();
    const targetsReactionsCounters = targetsReactionsCountersMap.getRoot();

    const initialReactions = reactionsMap.getRoot();
    const reactionWitness = reactionsMap.getWitness(reactionKey);
    reactionsMap.set(reactionKey, latestReactionsState.hash());
    const latestReactions = reactionsMap.getRoot();

    const currentPosts = postsMap.getRoot();
    const parentState = new PostState({
      posterAddress: PublicKey.fromBase58(parent!.posterAddress),
      postContentID: CircuitString.fromString(parent!.postContentID),
      allPostsCounter: Field(parent!.allPostsCounter),
      userPostsCounter: Field(parent!.userPostsCounter),
      postBlockHeight: Field(parent!.postBlockHeight),
      deletionBlockHeight: Field(parent!.deletionBlockHeight),
      restorationBlockHeight: Field(parent!.restorationBlockHeight)
    });
    const parentWitness = postsMap.getWitness(Field(parent!.postKey));

    const transition = ReactionsTransition.createReactionDeletionTransition(
      signature,
      currentPosts,
      parentState,
      parentWitness,
      currentAllReactionsCounter,
      usersReactionsCounters,
      targetsReactionsCounters,
      initialReactions,
      latestReactions,
      initialReactionState,
      reactionWitness,
      deletionBlockHeight
    );
    console.log('Transition created');
    
    return {
      transition: JSON.stringify(transition),
      signature: signatureBase58,
      targets: currentPosts.toString(),
      postState: JSON.stringify(parentState),
      targetWitness: JSON.stringify(parentWitness.toJSON()),
      currentAllReactionsCounter: currentAllReactionsCounter.toString(),
      usersReactionsCounters: usersReactionsCounters.toString(),
      targetsReactionsCounters: targetsReactionsCounters.toString(),
      initialReactions: initialReactions.toString(),
      latestReactions: latestReactions.toString(),
      initialReactionState: JSON.stringify(initialReactionState),
      reactionWitness: JSON.stringify(reactionWitness.toJSON()),
      deletionBlockHeight: deletionBlockHeight.toString()
    }
}

// ============================================================================

async function generateReactionRestorationInputs(parent: {
  postKey: string;
  posterAddress: string;
  postContentID: string;
  allPostsCounter: bigint;
  userPostsCounter: bigint;
  postBlockHeight: bigint;
  deletionBlockHeight: bigint;
  restorationBlockHeight: bigint;
  postSignature: string;
} | null,
isTargetPost: boolean, targetKey: string, reactorAddressBase58: string,
reactionCodePoint: bigint, allReactionsCounter: bigint, userReactionsCounter: bigint, targetReactionsCounter: bigint,
reactionBlockHeight: bigint, deletionBlockHeight: bigint, restorationBlockHeight: bigint, reactionKey: Field, signatureBase58: string,
newRestorationBlockHeight: Field, currentAllReactionsCounter: Field) {

const signature = Signature.fromBase58(signatureBase58);
const reactorAddress = PublicKey.fromBase58(reactorAddressBase58);
const reactionCodePointAsField = Field(reactionCodePoint);

    const initialReactionState = new ReactionState({
      isTargetPost: Bool(isTargetPost),
      targetKey: Field(targetKey),
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePointAsField,
      allReactionsCounter: Field(allReactionsCounter),
      userReactionsCounter: Field(userReactionsCounter),
      targetReactionsCounter: Field(targetReactionsCounter),
      reactionBlockHeight: Field(reactionBlockHeight),
      deletionBlockHeight: Field(deletionBlockHeight),
      restorationBlockHeight: Field(restorationBlockHeight)
    });

    const latestReactionsState = new ReactionState({
      isTargetPost: Bool(isTargetPost),
      targetKey: Field(targetKey),
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePointAsField,
      allReactionsCounter: Field(allReactionsCounter),
      userReactionsCounter: Field(userReactionsCounter),
      targetReactionsCounter: Field(targetReactionsCounter),
      reactionBlockHeight: Field(reactionBlockHeight),
      deletionBlockHeight: Field(0),
      restorationBlockHeight: newRestorationBlockHeight
    });

    const usersReactionsCounters = usersReactionsCountersMap.getRoot();
    const targetsReactionsCounters = targetsReactionsCountersMap.getRoot();

    const initialReactions = reactionsMap.getRoot();
    const reactionWitness = reactionsMap.getWitness(reactionKey);
    reactionsMap.set(reactionKey, latestReactionsState.hash());
    const latestReactions = reactionsMap.getRoot();

    const currentPosts = postsMap.getRoot();
    const parentState = new PostState({
      posterAddress: PublicKey.fromBase58(parent!.posterAddress),
      postContentID: CircuitString.fromString(parent!.postContentID),
      allPostsCounter: Field(parent!.allPostsCounter),
      userPostsCounter: Field(parent!.userPostsCounter),
      postBlockHeight: Field(parent!.postBlockHeight),
      deletionBlockHeight: Field(parent!.deletionBlockHeight),
      restorationBlockHeight: Field(parent!.restorationBlockHeight)
    });
    const parentWitness = postsMap.getWitness(Field(parent!.postKey));

    const transition = ReactionsTransition.createReactionRestorationTransition(
      signature,
      currentPosts,
      parentState,
      parentWitness,
      currentAllReactionsCounter,
      usersReactionsCounters,
      targetsReactionsCounters,
      initialReactions,
      latestReactions,
      initialReactionState,
      reactionWitness,
      newRestorationBlockHeight
    );
    console.log('Transition created');

    return {
      transition: JSON.stringify(transition),
      signature: signatureBase58,
      targets: currentPosts.toString(),
      postState: JSON.stringify(parentState),
      targetWitness: JSON.stringify(parentWitness.toJSON()),
      currentAllReactionsCounter: currentAllReactionsCounter.toString(),
      usersReactionsCounters: usersReactionsCounters.toString(),
      targetsReactionsCounters: targetsReactionsCounters.toString(),
      initialReactions: initialReactions.toString(),
      latestReactions: latestReactions.toString(),
      initialReactionState: JSON.stringify(initialReactionState),
      reactionWitness: JSON.stringify(reactionWitness.toJSON()),
      restorationBlockHeight: newRestorationBlockHeight.toString()
    }
}

// ============================================================================

  async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================