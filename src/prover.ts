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
import { PrismaClient, Prisma } from '@prisma/client';
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

const postsQueue = new Queue('postsQueue', {connection});
const postsQueueEvents = new QueueEvents('postsQueue', {connection});
const mergingPostsQueue = new Queue('mergingPostsQueue', {connection});
const mergingPostsQueueEvents = new QueueEvents('mergingPostsQueue', {connection});
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
const commentRestorationsQueue = new Queue('commentRestorationsQueue', {connection});
const commentRestorationsQueueEvents = new QueueEvents('commentRestorationsQueue', {connection});
const repostsQueue = new Queue('repostsQueue', {connection});
const repostsQueueEvents = new QueueEvents('repostsQueue', {connection});
const mergingRepostsQueue = new Queue('mergingRepostsQueue', {connection});
const mergingRepostsQueueEvents = new QueueEvents('mergingRepostsQueue', {connection});
const repostDeletionsQueue = new Queue('repostDeletionsQueue', {connection});
const repostDeletionsQueueEvents = new QueueEvents('repostDeletionsQueue', {connection});
const repostRestorationsQueue = new Queue('repostRestorationsQueue', {connection});
const repostRestorationsQueueEvents = new QueueEvents('repostRestorationsQueue', {connection});


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

let usersPostsCountersMap = new MerkleMap();
let postsMap = new MerkleMap();
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

class OnchainAndServerStateMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnchainAndServerStateMismatchError';
  }
}

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

const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS);
const INTERVAL = Number(process.env.INTERVAL);

while (true) {
  if (provingTurn === provingPosts) {

    let pendingPosts: PostsFindMany;
    let provePostInputs: ProvePostInputs[] = [];

    // Get actions that may have a pending associated transaction
    pendingPosts = await prisma.posts.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
      orderBy: {
          allPostsCounter: 'asc'
      },
      where: {
          status: 'creating'
      }
    });

    // If there isn't a pending transaction, process new actions
    if (pendingPosts.length === 0) {
      pendingPosts = await prisma.posts.findMany({
        take: Number(process.env.PARALLEL_NUMBER),
        orderBy: {
            allPostsCounter: 'asc'
        },
        where: {
            status: 'create'
        }
      });
      // Handle possible pending transaction confirmation or failure
    } else {
      postsContext.totalNumberOfPosts += pendingPosts.length;
      for (const pPost of pendingPosts) {
        const result = generateProvePostInputs(
          pPost.pendingSignature!,
          pPost.posterAddress,
          pPost.postContentID,
          pPost.allPostsCounter,
          pPost.userPostsCounter,
          pPost.pendingBlockHeight!,
          pPost.deletionBlockHeight,
          pPost.restorationBlockHeight
        );
        provePostInputs.push(result);
      }
      
      try {
        /* If a pending transaction was confirmed, syncing onchain and server state,
          restart loop to process new actions
        */
        console.log('Syncing onchain and server state since last post publications:');
        await assertPostsOnchainAndServerState(pendingPosts, pendingPosts[0].pendingBlockHeight!);
        continue;
      } catch (error) {
          /* If a pending transaction hasn't been successfully confirmed,
            reset server state to process the pending actions with a new blockheight
          */
         if (error instanceof OnchainAndServerStateMismatchError) {
          await resetServerPostPublicationsState(pendingPosts);
         } else {
          throw error;
         }
      }
    }

    if (pendingPosts.length !== 0) {
      postsContext.totalNumberOfPosts += pendingPosts.length;
      const lastBlock = await fetchLastBlock(configPosts.url);
      const currentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log('Current blockheight for post publications: ' + currentBlockHeight);
      provePostInputs.length = 0;
      for (const pPost of pendingPosts) {
        const result = generateProvePostInputs(
          pPost.pendingSignature!,
          pPost.posterAddress,
          pPost.postContentID,
          pPost.allPostsCounter,
          pPost.userPostsCounter,
          currentBlockHeight,
          pPost.deletionBlockHeight,
          pPost.restorationBlockHeight
        );
        provePostInputs.push(result);
        pPost.status = 'creating';
        await prisma.posts.update({
          where: {
            postKey: pPost.postKey
          },
          data: {
            status: 'creating',
            pendingBlockHeight: currentBlockHeight
          }
        });
      }

      const jobsPromises: Promise<any>[] = [];
      for (const provePostInput of provePostInputs) {
        const job = await postsQueue.add(
          `job`,
          { provePostInput: provePostInput }
        );
        jobsPromises.push(job.waitUntilFinished(postsQueueEvents));
      }

      startTime = performance.now();
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
      const transitionsAndProofs: {
        transition: PostsTransition,
        proof: PostsProof
      }[] = [];
      for (const transitionAndProof of transitionsAndProofsAsStrings) {
        transitionsAndProofs.push({
          transition: PostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await PostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
      endTime = performance.now();
      console.log(`Created ${pendingPosts.length} proofs in ${(endTime - startTime)/1000/60} minutes`);
    
      startTime = performance.now();
      const pendingTransaction = await updatePostsOnChainState(transitionsAndProofs);
      endTime = performance.now();
      console.log(`Merged ${pendingPosts.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      console.log('Confirming post publications transaction...');
      let status = 'pending';
      while (status === 'pending') {
        status = await getTransactionStatus(pendingTransaction);
      }
      endTime = performance.now();
      console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);

      if (status === 'rejected') {
        await resetServerPostPublicationsState(pendingPosts);
        continue;
      }

      await assertPostsOnchainAndServerState(pendingPosts, currentBlockHeight);
    }

  } else if (provingTurn === provingReactions) {

    const pendingReactions = await prisma.reactions.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
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

      for (const transitionAndProof of transitionsAndProofsAsStrings) {
        transitionsAndProofs.push({
          transition: ReactionsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await ReactionsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);
    
      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
        await updateReactionsOnChainState(transitionsAndProofs);
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        let allReactionsCounterFetch;
        let userReactionsCounterFetch;
        let targetReactionsCounterFetch;
        let reactionsFetch;
        while (tries < MAX_ATTEMPTS) {
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
            tries = MAX_ATTEMPTS;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === MAX_ATTEMPTS - 1) {
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

    let pendingComments: CommentsFindMany;
    let proveCommentsInputs: ProveCommentInputs[] = [];

    // Get actions that may have a pending associated transaction
    pendingComments = await prisma.comments.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
      orderBy: {
          allCommentsCounter: 'asc'
      },
      where: {
          status: 'creating'
      }
    });

    // If there isn't a pending transaction, process new actions
    if (pendingComments.length === 0) {
      pendingComments = await prisma.comments.findMany({
        take: Number(process.env.PARALLEL_NUMBER),
        orderBy: {
            allCommentsCounter: 'asc'
        },
        where: {
            status: 'create'
        }
      });
      // Handle possible pending transaction confirmation or failure
    } else {
      commentsContext.totalNumberOfComments += pendingComments.length;
      for (const pComment of pendingComments) {
        const result = await generateProveCommentInputs(
          pComment.isTargetPost,
          pComment.targetKey,
          pComment.commenterAddress,
          pComment.commentContentID,
          pComment.allCommentsCounter,
          pComment.userCommentsCounter,
          pComment.targetCommentsCounter,
          pComment.pendingBlockHeight!,
          pComment.deletionBlockHeight,
          pComment.restorationBlockHeight,
          pComment.pendingSignature!
        );
        proveCommentsInputs.push(result);
      }
      
      try {
        /* If a pending transaction was confirmed, syncing onchain and server state,
          restart loop to process new actions
        */
        console.log('Syncing onchain and server state since last comment publications:');
        await assertCommentsOnchainAndServerState(pendingComments, pendingComments[0].pendingBlockHeight!);
        continue;
      } catch (error) {
          /* If a pending transaction hasn't been successfully confirmed,
            reset server state to process the pending actions with a new blockheight
          */
         if (error instanceof OnchainAndServerStateMismatchError) {
          await resetServerCommentPublicationsState(pendingComments);
         } else {
          throw error;
         }
      }
    }

    if (pendingComments.length !== 0) {
      commentsContext.totalNumberOfComments += pendingComments.length;
      const lastBlock = await fetchLastBlock(configComments.url);
      const currentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log('Current blockheight for comment publications: ' + currentBlockHeight);
      proveCommentsInputs.length = 0;
      for (const pComment of pendingComments) {
        const result = await generateProveCommentInputs(
          pComment.isTargetPost,
          pComment.targetKey,
          pComment.commenterAddress,
          pComment.commentContentID,
          pComment.allCommentsCounter,
          pComment.userCommentsCounter,
          pComment.targetCommentsCounter,
          currentBlockHeight,
          pComment.deletionBlockHeight,
          pComment.restorationBlockHeight,
          pComment.pendingSignature!
        );
        proveCommentsInputs.push(result);
        pComment.status = 'creating';
        await prisma.comments.update({
          where: {
            commentKey: pComment.commentKey
          },
          data: {
            status: 'creating',
            pendingBlockHeight: currentBlockHeight
          }
        });
      }

      const jobsPromises: Promise<any>[] = [];
      for (const proveCommentInputs of proveCommentsInputs) {
        const job = await commentsQueue.add(
          `job`,
          { proveCommentInputs: proveCommentInputs }
        );
        jobsPromises.push(job.waitUntilFinished(commentsQueueEvents));
      }

      startTime = performance.now();
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
      const transitionsAndProofs: {
        transition: CommentsTransition,
        proof: CommentsProof
      }[] = [];
      for (const transitionAndProof of transitionsAndProofsAsStrings) {
        transitionsAndProofs.push({
          transition: CommentsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await CommentsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
      endTime = performance.now();
      console.log(`Created ${pendingComments.length} proofs in ${(endTime - startTime)/1000/60} minutes`);
    
      startTime = performance.now();
      const pendingTransaction = await updateCommentsOnChainState(transitionsAndProofs);
      endTime = performance.now();
      console.log(`Merged ${pendingComments.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      console.log('Confirming comment publications transaction...');
      let status = 'pending';
      while (status === 'pending') {
        status = await getTransactionStatus(pendingTransaction);
      }
      endTime = performance.now();
      console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);

      if (status === 'rejected') {
        await resetServerCommentPublicationsState(pendingComments);
        continue;
      }

      await assertCommentsOnchainAndServerState(pendingComments, currentBlockHeight);
    }

  } else if (provingTurn === provingReposts) {

    const pendingReposts = await prisma.reposts.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
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

      const proveRepostInputs: {
        transition: string,
        signature: string,
        targets: string,
        postState: string,
        targetWitness: string,
        repostState: string,
        initialUsersRepostsCounters: string,
        latestUsersRepostsCounters: string,
        userRepostsCounterWitness: string,
        initialTargetsRepostsCounters: string,
        latestTargetsRepostsCounters: string,
        targetRepostsCounterWitness: string,
        initialReposts: string,
        latestReposts: string,
        repostWitness: string
      }[] = [];
    
      for (const pRepost of pendingReposts) {
        const result = await generateProveRepostInputs(
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
    
        proveRepostInputs.push(result);
      }

      const jobsPromises: Promise<any>[] = [];

      for (const proveRepostInput of proveRepostInputs) {
        const job = await repostsQueue.add(
          `job`,
          { proveRepostInput: proveRepostInput }
        );
        jobsPromises.push(job.waitUntilFinished(repostsQueueEvents));
      }
  
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
    
      const transitionsAndProofs: {
        transition: RepostsTransition,
        proof: RepostsProof
      }[] = [];

      for (const transitionAndProof of transitionsAndProofsAsStrings) {
        transitionsAndProofs.push({
          transition: RepostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await RepostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);
    
      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
        await updateRepostsOnChainState(transitionsAndProofs);
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        let allRepostsCounterFetch;
        let userRepostsCounterFetch;
        let targetRepostsCounterFetch;
        let repostsFetch;
        while (tries < MAX_ATTEMPTS) {
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
            tries = MAX_ATTEMPTS;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === MAX_ATTEMPTS - 1) {
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

     let pendingPostDeletions: PostsFindMany;
     let provePostDeletionsInputs: ProvePostUpdateInputs[] = [];
 
     // Get actions that may have a pending associated transaction
     pendingPostDeletions = await prisma.posts.findMany({
       take: Number(process.env.PARALLEL_NUMBER),
       orderBy: {
           allPostsCounter: 'asc'
       },
       where: {
           status: 'deleting'
       }
     });
 
     // If there isn't a pending transaction, process new actions
     if (pendingPostDeletions.length === 0) {
      pendingPostDeletions = await prisma.posts.findMany({
         take: Number(process.env.PARALLEL_NUMBER),
         orderBy: {
             allPostsCounter: 'asc'
         },
         where: {
             status: 'delete'
         }
       });
       // Handle possible pending transaction confirmation or failure
     } else {
       for (const pendingPostDeletion of pendingPostDeletions) {
         const result = generatePostDeletionInputs(
          pendingPostDeletion!.posterAddress,
          pendingPostDeletion!.postContentID,
          pendingPostDeletion!.allPostsCounter,
          pendingPostDeletion!.userPostsCounter,
          pendingPostDeletion!.postBlockHeight,
          pendingPostDeletion!.restorationBlockHeight,
          Field(pendingPostDeletion!.postKey),
          pendingPostDeletion.pendingSignature!,
          Field(pendingPostDeletion.pendingBlockHeight!),
          Field(postsContext.totalNumberOfPosts)
         );
         provePostDeletionsInputs.push(result);
       }
       
       try {
         /* If a pending transaction was confirmed, syncing onchain and server state,
           restart loop to process new actions
         */
         console.log('Syncing onchain and server state since last post deletions:');
         await assertPostsOnchainAndServerState(pendingPostDeletions, pendingPostDeletions[0].pendingBlockHeight!);
         continue;
       } catch (error) {
           /* If a pending transaction hasn't been successfully confirmed,
             reset server state to process the pending actions with a new blockheight
           */
          if (error instanceof OnchainAndServerStateMismatchError) {
           resetServerPostUpdatesState(pendingPostDeletions);
          } else {
           throw error;
          }
       }
     }
 
     if (pendingPostDeletions.length !== 0) {
       const lastBlock = await fetchLastBlock(configPosts.url);
       const currentBlockHeight = lastBlock.blockchainLength.toBigint();
       console.log('Current blockheight for post deletions: ' + currentBlockHeight);
       provePostDeletionsInputs.length = 0;
       for (const pendingPostDeletion of pendingPostDeletions) {
         const result = generatePostDeletionInputs(
          pendingPostDeletion!.posterAddress,
          pendingPostDeletion!.postContentID,
          pendingPostDeletion!.allPostsCounter,
          pendingPostDeletion!.userPostsCounter,
          pendingPostDeletion!.postBlockHeight,
          pendingPostDeletion!.restorationBlockHeight,
          Field(pendingPostDeletion!.postKey),
          pendingPostDeletion.pendingSignature!,
          Field(currentBlockHeight),
          Field(postsContext.totalNumberOfPosts)
         );
         provePostDeletionsInputs.push(result);
         pendingPostDeletion.status = 'deleting';
         await prisma.posts.update({
           where: {
             postKey: pendingPostDeletion.postKey
           },
           data: {
             status: 'deleting',
             pendingBlockHeight: currentBlockHeight
           }
         });
       }
 
       const jobsPromises: Promise<any>[] = [];
       for (const provePostDeletionInputs of provePostDeletionsInputs) {
         const job = await postDeletionsQueue.add(
           `job`,
           { provePostDeletionInputs: provePostDeletionInputs }
         );
         jobsPromises.push(job.waitUntilFinished(postDeletionsQueueEvents));
       }
 
       startTime = performance.now();
       const transitionsAndProofsAsStrings: {
         transition: string;
         proof: string;
       }[] = await Promise.all(jobsPromises);
       const transitionsAndProofs: {
         transition: PostsTransition,
         proof: PostsProof
       }[] = [];
       for (const transitionAndProof of transitionsAndProofsAsStrings) {
         transitionsAndProofs.push({
           transition: PostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
           proof: await PostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
         });
       }
       endTime = performance.now();
       console.log(`Created ${pendingPostDeletions.length} proofs in ${(endTime - startTime)/1000/60} minutes`);
     
       startTime = performance.now();
       const pendingTransaction = await updatePostsOnChainState(transitionsAndProofs);
       endTime = performance.now();
       console.log(`Merged ${pendingPostDeletions.length} proofs in ${(endTime - startTime)/1000/60} minutes`);
 
       startTime = performance.now();
       console.log('Confirming post deletions transaction...');
       let status = 'pending';
       while (status === 'pending') {
         status = await getTransactionStatus(pendingTransaction);
       }
       endTime = performance.now();
       console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);
 
       if (status === 'rejected') {
         resetServerPostUpdatesState(pendingPostDeletions);
         continue;
       }
 
       await assertPostsOnchainAndServerState(pendingPostDeletions, currentBlockHeight);
     }

  }  else if (provingTurn === provingPostRestorations) {


    let pendingPostRestorations: PostsFindMany;
    let provePostRestorationsInputs: ProvePostUpdateInputs[] = [];

    // Get actions that may have a pending associated transaction
    pendingPostRestorations = await prisma.posts.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
      orderBy: {
          allPostsCounter: 'asc'
      },
      where: {
          status: 'restoring'
      }
    });

    // If there isn't a pending transaction, process new actions
    if (pendingPostRestorations.length === 0) {
      pendingPostRestorations = await prisma.posts.findMany({
        take: Number(process.env.PARALLEL_NUMBER),
        orderBy: {
            allPostsCounter: 'asc'
        },
        where: {
            status: 'restore'
        }
      });
      // Handle possible pending transaction confirmation or failure
    } else {
      for (const pendingPostRestoration of pendingPostRestorations) {
        const result = generatePostRestorationInputs(
          pendingPostRestoration!.posterAddress,
          pendingPostRestoration!.postContentID,
          pendingPostRestoration!.allPostsCounter,
          pendingPostRestoration!.userPostsCounter,
          pendingPostRestoration!.postBlockHeight,
          pendingPostRestoration!.deletionBlockHeight,
          pendingPostRestoration!.restorationBlockHeight,
          Field(pendingPostRestoration!.postKey),
          pendingPostRestoration.pendingSignature!,
          Field(pendingPostRestoration.pendingBlockHeight!),
          Field(postsContext.totalNumberOfPosts)
        );
        provePostRestorationsInputs.push(result);
      }
      
      try {
        /* If a pending transaction was confirmed, syncing onchain and server state,
          restart loop to process new actions
        */
        console.log('Syncing onchain and server state since last post restorations:');
        await assertPostsOnchainAndServerState(pendingPostRestorations, pendingPostRestorations[0].pendingBlockHeight!);
        continue;
      } catch (error) {
          /* If a pending transaction hasn't been successfully confirmed,
            reset server state to process the pending actions with a new blockheight
          */
         if (error instanceof OnchainAndServerStateMismatchError) {
          resetServerPostUpdatesState(pendingPostRestorations);
         } else {
          throw error;
         }
      }
    }

    if (pendingPostRestorations.length !== 0) {
      const lastBlock = await fetchLastBlock(configPosts.url);
      const currentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log('Current blockheight for post restorations: ' + currentBlockHeight);
      provePostRestorationsInputs.length = 0;
      for (const pendingPostRestoration of pendingPostRestorations) {
        const result = generatePostRestorationInputs(
          pendingPostRestoration!.posterAddress,
          pendingPostRestoration!.postContentID,
          pendingPostRestoration!.allPostsCounter,
          pendingPostRestoration!.userPostsCounter,
          pendingPostRestoration!.postBlockHeight,
          pendingPostRestoration!.deletionBlockHeight,
          pendingPostRestoration!.restorationBlockHeight,
          Field(pendingPostRestoration!.postKey),
          pendingPostRestoration.pendingSignature!,
          Field(currentBlockHeight),
          Field(postsContext.totalNumberOfPosts)
        );
        provePostRestorationsInputs.push(result);
        pendingPostRestoration.status = 'restoring';
        await prisma.posts.update({
          where: {
            postKey: pendingPostRestoration.postKey
          },
          data: {
            status: 'restoring',
            pendingBlockHeight: currentBlockHeight
          }
        });
      }

      const jobsPromises: Promise<any>[] = [];
      for (const provePostRestorationInputs of provePostRestorationsInputs) {
        const job = await postRestorationsQueue.add(
          `job`,
          { provePostRestorationInputs: provePostRestorationInputs }
        );
        jobsPromises.push(job.waitUntilFinished(postRestorationsQueueEvents));
      }

      startTime = performance.now();
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
      const transitionsAndProofs: {
        transition: PostsTransition,
        proof: PostsProof
      }[] = [];
      for (const transitionAndProof of transitionsAndProofsAsStrings) {
        transitionsAndProofs.push({
          transition: PostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await PostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
      endTime = performance.now();
      console.log(`Created ${pendingPostRestorations.length} proofs in ${(endTime - startTime)/1000/60} minutes`);
    
      startTime = performance.now();
      const pendingTransaction = await updatePostsOnChainState(transitionsAndProofs);
      endTime = performance.now();
      console.log(`Merged ${pendingPostRestorations.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      console.log('Confirming post restorations transaction...');
      let status = 'pending';
      while (status === 'pending') {
        status = await getTransactionStatus(pendingTransaction);
      }
      endTime = performance.now();
      console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);

      if (status === 'rejected') {
        resetServerPostUpdatesState(pendingPostRestorations);
        continue;
      }

      await assertPostsOnchainAndServerState(pendingPostRestorations, currentBlockHeight);
    }

  } else if (provingTurn === provingCommentDeletions) {

    let pendingCommentDeletions: CommentsFindMany;
    let proveCommentDeletionsInputs: ProveCommentsUpdateInputs[] = [];

    // Get actions that may have a pending associated transaction
    pendingCommentDeletions = await prisma.comments.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
      orderBy: {
          allCommentsCounter: 'asc'
      },
      where: {
          status: 'deleting'
      }
    });

    // If there isn't a pending transaction, process new actions
    if (pendingCommentDeletions.length === 0) {
      pendingCommentDeletions = await prisma.comments.findMany({
        take: Number(process.env.PARALLEL_NUMBER),
        orderBy: {
            allCommentsCounter: 'asc'
        },
        where: {
            status: 'delete'
        }
      });
      // Handle possible pending transaction confirmation or failure
    } else {
      for (const pendingCommentDeletion of pendingCommentDeletions) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingCommentDeletion!.targetKey
          }
        });

        const result = generateProveCommentDeletionInputs(
          parent,
          pendingCommentDeletion.isTargetPost,
          pendingCommentDeletion.targetKey,
          pendingCommentDeletion.commenterAddress,
          pendingCommentDeletion.commentContentID,
          pendingCommentDeletion.allCommentsCounter,
          pendingCommentDeletion.userCommentsCounter,
          pendingCommentDeletion.targetCommentsCounter,
          pendingCommentDeletion.commentBlockHeight,
          pendingCommentDeletion.restorationBlockHeight,
          Field(pendingCommentDeletion.commentKey),
          pendingCommentDeletion.pendingSignature!,
          Field(pendingCommentDeletion.pendingBlockHeight!),
          Field(commentsContext.totalNumberOfComments)
        );
        proveCommentDeletionsInputs.push(result);
      }
      
      try {
        /* If a pending transaction was confirmed, syncing onchain and server state,
          restart loop to process new actions
        */
        console.log('Syncing onchain and server state since last comment deletions:');
        await assertCommentsOnchainAndServerState(pendingCommentDeletions, pendingCommentDeletions[0].pendingBlockHeight!);
        continue;
      } catch (error) {
          /* If a pending transaction hasn't been successfully confirmed,
            reset server state to process the pending actions with a new blockheight
          */
         if (error instanceof OnchainAndServerStateMismatchError) {
          resetServerCommentUpdatesState(pendingCommentDeletions);
         } else {
          throw error;
         }
      }
    }

    if (pendingCommentDeletions.length !== 0) {
      const lastBlock = await fetchLastBlock(configComments.url);
      const currentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log('Current blockheight for comment deletions: ' + currentBlockHeight);
      proveCommentDeletionsInputs.length = 0;
      for (const pendingCommentDeletion of pendingCommentDeletions) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingCommentDeletion!.targetKey
          }
        });

        const result = generateProveCommentDeletionInputs(
          parent,
          pendingCommentDeletion.isTargetPost,
          pendingCommentDeletion.targetKey,
          pendingCommentDeletion.commenterAddress,
          pendingCommentDeletion.commentContentID,
          pendingCommentDeletion.allCommentsCounter,
          pendingCommentDeletion.userCommentsCounter,
          pendingCommentDeletion.targetCommentsCounter,
          pendingCommentDeletion.commentBlockHeight,
          pendingCommentDeletion.restorationBlockHeight,
          Field(pendingCommentDeletion.commentKey),
          pendingCommentDeletion.pendingSignature!,
          Field(currentBlockHeight),
          Field(commentsContext.totalNumberOfComments)
        );
        proveCommentDeletionsInputs.push(result);
        pendingCommentDeletion.status = 'deleting';
        await prisma.comments.update({
          where: {
            commentKey: pendingCommentDeletion.commentKey
          },
          data: {
            status: 'deleting',
            pendingBlockHeight: currentBlockHeight
          }
        });
      }

      const jobsPromises: Promise<any>[] = [];
      for (const proveCommentDeletionInputs of proveCommentDeletionsInputs) {
        const job = await commentDeletionsQueue.add(
          `job`,
          { proveCommentDeletionInputs: proveCommentDeletionInputs }
        );
        jobsPromises.push(job.waitUntilFinished(commentDeletionsQueueEvents));
      }

      startTime = performance.now();
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
      const transitionsAndProofs: {
        transition: CommentsTransition,
        proof: CommentsProof
      }[] = [];
      for (const transitionAndProof of transitionsAndProofsAsStrings) {
        transitionsAndProofs.push({
          transition: CommentsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await CommentsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
      endTime = performance.now();
      console.log(`Created ${pendingCommentDeletions.length} proofs in ${(endTime - startTime)/1000/60} minutes`);
    
      startTime = performance.now();
      const pendingTransaction = await updateCommentsOnChainState(transitionsAndProofs);
      endTime = performance.now();
      console.log(`Merged ${pendingCommentDeletions.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      console.log('Confirming comment deletions transaction...');
      let status = 'pending';
      while (status === 'pending') {
        status = await getTransactionStatus(pendingTransaction);
      }
      endTime = performance.now();
      console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);

      if (status === 'rejected') {
        resetServerCommentUpdatesState(pendingCommentDeletions);
        continue;
      }

      await assertCommentsOnchainAndServerState(pendingCommentDeletions, currentBlockHeight);
    }

  } else if (provingTurn === provingCommentRestorations) {

    let pendingCommentRestorations: CommentsFindMany;
    let proveCommentRestorationsInputs: ProveCommentsUpdateInputs[] = [];

    // Get actions that may have a pending associated transaction
    pendingCommentRestorations = await prisma.comments.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
      orderBy: {
          allCommentsCounter: 'asc'
      },
      where: {
          status: 'restoring'
      }
    });

    // If there isn't a pending transaction, process new actions
    if (pendingCommentRestorations.length === 0) {
      pendingCommentRestorations = await prisma.comments.findMany({
        take: Number(process.env.PARALLEL_NUMBER),
        orderBy: {
            allCommentsCounter: 'asc'
        },
        where: {
            status: 'restore'
        }
      });
      // Handle possible pending transaction confirmation or failure
    } else {
      for (const pendingCommentRestoration of pendingCommentRestorations) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingCommentRestoration!.targetKey
          }
        });

        const result = generateProveCommentRestorationInputs(
          parent,
          pendingCommentRestoration.isTargetPost,
          pendingCommentRestoration.targetKey,
          pendingCommentRestoration.commenterAddress,
          pendingCommentRestoration.commentContentID,
          pendingCommentRestoration.allCommentsCounter,
          pendingCommentRestoration.userCommentsCounter,
          pendingCommentRestoration.targetCommentsCounter,
          pendingCommentRestoration.commentBlockHeight,
          pendingCommentRestoration.deletionBlockHeight,
          pendingCommentRestoration.restorationBlockHeight,
          Field(pendingCommentRestoration!.commentKey),
          pendingCommentRestoration.pendingSignature!,
          Field(pendingCommentRestoration.pendingBlockHeight!),
          Field(commentsContext.totalNumberOfComments)
        );
        proveCommentRestorationsInputs.push(result);
      }
      
      try {
        /* If a pending transaction was confirmed, syncing onchain and server state,
          restart loop to process new actions
        */
        console.log('Syncing onchain and server state since last comment restorations:');
        await assertCommentsOnchainAndServerState(pendingCommentRestorations, pendingCommentRestorations[0].pendingBlockHeight!);
        continue;
      } catch (error) {
          /* If a pending transaction hasn't been successfully confirmed,
            reset server state to process the pending actions with a new blockheight
          */
         if (error instanceof OnchainAndServerStateMismatchError) {
          resetServerCommentUpdatesState(pendingCommentRestorations);
         } else {
          throw error;
         }
      }
    }

    if (pendingCommentRestorations.length !== 0) {
      const lastBlock = await fetchLastBlock(configComments.url);
      const currentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log('Current blockheight for comment restorations: ' + currentBlockHeight);
      proveCommentRestorationsInputs.length = 0;
      for (const pendingCommentRestoration of pendingCommentRestorations) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingCommentRestoration!.targetKey
          }
        });

        const result = generateProveCommentRestorationInputs(
          parent,
          pendingCommentRestoration.isTargetPost,
          pendingCommentRestoration.targetKey,
          pendingCommentRestoration.commenterAddress,
          pendingCommentRestoration.commentContentID,
          pendingCommentRestoration.allCommentsCounter,
          pendingCommentRestoration.userCommentsCounter,
          pendingCommentRestoration.targetCommentsCounter,
          pendingCommentRestoration.commentBlockHeight,
          pendingCommentRestoration.deletionBlockHeight,
          pendingCommentRestoration.restorationBlockHeight,
          Field(pendingCommentRestoration.commentKey),
          pendingCommentRestoration.pendingSignature!,
          Field(currentBlockHeight),
          Field(commentsContext.totalNumberOfComments)
        );
        proveCommentRestorationsInputs.push(result);
        pendingCommentRestoration.status = 'restoring';
        await prisma.comments.update({
          where: {
            commentKey: pendingCommentRestoration.commentKey
          },
          data: {
            status: 'restoring',
            pendingBlockHeight: currentBlockHeight
          }
        });
      }

      const jobsPromises: Promise<any>[] = [];
      for (const proveCommentRestorationInputs of proveCommentRestorationsInputs) {
        const job = await commentRestorationsQueue.add(
          `job`,
          { proveCommentRestorationInputs: proveCommentRestorationInputs }
        );
        jobsPromises.push(job.waitUntilFinished(commentRestorationsQueueEvents));
      }

      startTime = performance.now();
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
      const transitionsAndProofs: {
        transition: CommentsTransition,
        proof: CommentsProof
      }[] = [];
      for (const transitionAndProof of transitionsAndProofsAsStrings) {
        transitionsAndProofs.push({
          transition: CommentsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await CommentsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
      endTime = performance.now();
      console.log(`Created ${pendingCommentRestorations.length} proofs in ${(endTime - startTime)/1000/60} minutes`);
    
      startTime = performance.now();
      const pendingTransaction = await updateCommentsOnChainState(transitionsAndProofs);
      endTime = performance.now();
      console.log(`Merged ${pendingCommentRestorations.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      console.log('Confirming comment restorations transaction...');
      let status = 'pending';
      while (status === 'pending') {
        status = await getTransactionStatus(pendingTransaction);
      }
      endTime = performance.now();
      console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);

      if (status === 'rejected') {
        resetServerCommentUpdatesState(pendingCommentRestorations);
        continue;
      }

      await assertCommentsOnchainAndServerState(pendingCommentRestorations, currentBlockHeight);
    }

  } else if (provingTurn === provingRepostDeletions) {

    const pendingRepostDeletions = await prisma.repostDeletions.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
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

      const proveRepostDeletionInputs: {
        transition: string,
        signature: string,
        targets: string,
        postState: string,
        targetWitness: string,
        currentAllRepostsCounter: string,
        usersRepostsCounters: string,
        targetsRepostsCounters: string,
        initialReposts: string,
        latestReposts: string,
        initialRepostState: string,
        repostWitness: string,
        deletionBlockHeight: string
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

        const result = generateProveRepostDeletionInputs(
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
    
        proveRepostDeletionInputs.push(result);
      }

      const jobsPromises: Promise<any>[] = [];

      for (const proveRepostDeletionInput of proveRepostDeletionInputs) {
        const job = await repostDeletionsQueue.add(
          `job`,
          { proveRepostDeletionInput: proveRepostDeletionInput }
        );
        jobsPromises.push(job.waitUntilFinished(repostDeletionsQueueEvents));
      }
  
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
    
      const transitionsAndProofs: {
        transition: RepostsTransition,
        proof: RepostsProof
      }[] = [];

      for (const transitionAndProof of transitionsAndProofsAsStrings) {
        transitionsAndProofs.push({
          transition: RepostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await RepostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);

      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
        await updateRepostsOnChainState(transitionsAndProofs);
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        let allRepostsCounterFetch;
        let usersRepostsCountersFetch;
        let targetsRepostsCountersFetch;
        let repostsFetch;
        while (tries < MAX_ATTEMPTS) {
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
            tries = MAX_ATTEMPTS;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === MAX_ATTEMPTS - 1) {

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
      take: Number(process.env.PARALLEL_NUMBER),
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

      const proveRepostRestorationInputs: {
        transition: string,
        signature: string,
        targets: string,
        postState: string,
        targetWitness: string,
        currentAllRepostsCounter: string,
        usersRepostsCounters: string,
        targetsRepostsCounters: string,
        initialReposts: string,
        latestReposts: string,
        initialRepostState: string,
        repostWitness: string,
        restorationBlockHeight: string
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

        const result = generateProveRepostRestoration(
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
    
        proveRepostRestorationInputs.push(result);
      }

      const jobsPromises: Promise<any>[] = [];

      for (const proveRepostRestorationInput of proveRepostRestorationInputs) {
        const job = await repostRestorationsQueue.add(
          `job`,
          { proveRepostRestorationInput: proveRepostRestorationInput }
        );
        jobsPromises.push(job.waitUntilFinished(repostRestorationsQueueEvents));
      }
  
      const transitionsAndProofsAsStrings: {
        transition: string;
        proof: string;
      }[] = await Promise.all(jobsPromises);
    
      const transitionsAndProofs: {
        transition: RepostsTransition,
        proof: RepostsProof
      }[] = [];

      for (const transitionAndProof of transitionsAndProofsAsStrings) {
        transitionsAndProofs.push({
          transition: RepostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await RepostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);

      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
        await updateRepostsOnChainState(transitionsAndProofs);
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        let allRepostsCounterFetch;
        let usersRepostsCountersFetch;
        let targetsRepostsCountersFetch;
        let repostsFetch;
        while (tries < MAX_ATTEMPTS) {
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
            tries = MAX_ATTEMPTS;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === MAX_ATTEMPTS - 1) {

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
      take: Number(process.env.PARALLEL_NUMBER),
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

        const result = generateReactionDeletionInputs(
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

      for (const transitionAndProof of transitionsAndProofsAsStrings) {
        transitionsAndProofs.push({
          transition: ReactionsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await ReactionsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);

      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
        await updateReactionsOnChainState(transitionsAndProofs);
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        let allReactionsCounterFetch;
        let usersReactionsCountersFetch;
        let targetsReactionsCountersFetch;
        let reactionsFetch;
        while (tries < MAX_ATTEMPTS) {
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
            tries = MAX_ATTEMPTS;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === MAX_ATTEMPTS - 1) {

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
      take: Number(process.env.PARALLEL_NUMBER),
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

        const result = generateReactionRestorationInputs(
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

      for (const transitionAndProof of transitionsAndProofsAsStrings) {
        transitionsAndProofs.push({
          transition: ReactionsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await ReactionsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);

      if (transitionsAndProofs.length !== 0) {
        startTime = performance.now();
        await updateReactionsOnChainState(transitionsAndProofs);
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        let allReactionsCounterFetch;
        let usersReactionsCountersFetch;
        let targetsReactionsCountersFetch;
        let reactionsFetch;
        while (tries < MAX_ATTEMPTS) {
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
            tries = MAX_ATTEMPTS;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === MAX_ATTEMPTS - 1) {

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

function generateProvePostInputs(signatureBase58: string, posterAddressBase58: string,
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
      console.log('Post publication transition created');

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
    const job = await mergingPostsQueue.add(
      `job`,
      { mergedTransition: JSON.stringify(mergedTransition),
        proof1: JSON.stringify(tp1.proof.toJSON()),
        proof2: JSON.stringify(tp2.proof.toJSON())
      }
    );
    return job.waitUntilFinished(mergingPostsQueueEvents);
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

      for (const transitionAndProof of processedMergedTransitionsAndProofs) {
        processedMergedTransitionsAndProofsCasted.push({
          transition: PostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await PostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }

      return recursiveMerge(processedMergedTransitionsAndProofsCasted);
  }

  const result = await recursiveMerge(transitionsAndProofs);
  
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    async () => {
      postsContract.update(result.proof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn !== undefined) {
    console.log(`https://minascan.io/devnet/tx/${sentTxn.hash}`);
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
  console.log('Reaction publication transition created');

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

      for (const transitionAndProof of processedMergedTransitionsAndProofs) {
        processedMergedTransitionsAndProofsCasted.push({
          transition: ReactionsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await ReactionsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }

      return recursiveMerge(processedMergedTransitionsAndProofsCasted);
  }

  const result = await recursiveMerge(transitionsAndProofs);
  
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    async () => {
      reactionsContract.update(result.proof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn !== undefined) {
    console.log(`https://minascan.io/devnet/tx/${sentTxn.hash}`);
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
  console.log('Comment transition created');

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

      for (const transitionAndProof of processedMergedTransitionsAndProofs) {
        processedMergedTransitionsAndProofsCasted.push({
          transition: CommentsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await CommentsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }

      return recursiveMerge(processedMergedTransitionsAndProofsCasted);
  }

  const result = await recursiveMerge(transitionsAndProofs);
  
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    async () => {
      commentsContract.update(result.proof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn !== undefined) {
    console.log(`https://minascan.io/devnet/tx/${sentTxn.hash}`);
  }

  return sentTxn;
}

// ============================================================================

async function generateProveRepostInputs(isTargetPost: boolean, targetKey: string,
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
  console.log('Repost publication transition created');

  return {
    transition: JSON.stringify(transition),
    signature: signatureBase58,
    targets: postsMap.getRoot().toString(),
    postState: JSON.stringify(postState),
    targetWitness: JSON.stringify(targetWitness.toJSON()),
    repostState: JSON.stringify(repostState),
    initialUsersRepostsCounters: initialUsersRepostsCounters.toString(),
    latestUsersRepostsCounters: latestUsersRepostsCounters.toString(),
    userRepostsCounterWitness: JSON.stringify(userRepostsCounterWitness.toJSON()),
    initialTargetsRepostsCounters: initialTargetsRepostsCounters.toString(),
    latestTargetsRepostsCounters: latestTargetsRepostsCounters.toString(),
    targetRepostsCounterWitness: JSON.stringify(targetRepostsCounterWitness.toJSON()),
    initialReposts: initialReposts.toString(),
    latestReposts: latestReposts.toString(),
    repostWitness: JSON.stringify(repostWitness.toJSON())
  }
}

// ============================================================================

type RepostTransitionAndProof = {
  transition: RepostsTransition,
  proof: RepostsProof
}

async function updateRepostsOnChainState(transitionsAndProofs: RepostTransitionAndProof[]) {

  async function mergeTransitionsAndProofs(tp1: RepostTransitionAndProof, tp2: RepostTransitionAndProof) {
    const mergedTransition = RepostsTransition.mergeRepostsTransitions(tp1.transition, tp2.transition);
    const job = await mergingRepostsQueue.add(
      `job`,
      { mergedTransition: JSON.stringify(mergedTransition),
        proof1: JSON.stringify(tp1.proof.toJSON()),
        proof2: JSON.stringify(tp2.proof.toJSON())
      }
    );
    return job.waitUntilFinished(mergingRepostsQueueEvents);
  }

  async function recursiveMerge(transitionsAndProofs: RepostTransitionAndProof[]): Promise<RepostTransitionAndProof> {
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
      const processedMergedTransitionsAndProofsCasted: RepostTransitionAndProof[] = [];

      for (const transitionAndProof of processedMergedTransitionsAndProofs) {
        processedMergedTransitionsAndProofsCasted.push({
          transition: RepostsTransition.fromJSON(JSON.parse(transitionAndProof.transition)),
          proof: await RepostsProof.fromJSON(JSON.parse(transitionAndProof.proof))
        });
      }
      
      return recursiveMerge(processedMergedTransitionsAndProofsCasted);
  }

  const result = await recursiveMerge(transitionsAndProofs);
  
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    async () => {
      repostsContract.update(result.proof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn !== undefined) {
    console.log(`https://minascan.io/devnet/tx/${sentTxn.hash}`);
  }

  return sentTxn;
}

// ============================================================================

function generatePostDeletionInputs(posterAddressBase58: string,
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

      return {
        transition: JSON.stringify(transition),
        signature: signatureBase58,
        currentAllPostsCounter: currentAllPostsCounter.toString(),
        usersPostsCounters: usersPostsCounters.toString(),
        initialPosts: initialPosts.toString(),
        latestPosts: latestPosts.toString(),
        initialPostState: JSON.stringify(initialPostState),
        postWitness: JSON.stringify(postWitness.toJSON()),
        blockHeight: deletionBlockHeight.toString()
      }
}

// ============================================================================

function generatePostRestorationInputs(posterAddressBase58: string,
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

      return {
        transition: JSON.stringify(transition),
        signature: signatureBase58,
        currentAllPostsCounter: currentAllPostsCounter.toString(),
        usersPostsCounters: usersPostsCounters.toString(),
        initialPosts: initialPosts.toString(),
        latestPosts: latestPosts.toString(),
        initialPostState: JSON.stringify(initialPostState),
        postWitness: JSON.stringify(postWitness.toJSON()),
        blockHeight: newRestorationBlockHeight.toString()
      }
}

// ============================================================================

function generateProveCommentDeletionInputs(parent: PostsFindUnique,
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
      console.log('Comment deletion transition created');

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
        blockHeight: deletionBlockHeight.toString()
      }
}

// ============================================================================

function generateProveCommentRestorationInputs(parent: PostsFindUnique,
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
    console.log('Comment restoration transition created');

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
      blockHeight: newRestorationBlockHeight.toString()
    }
}
  
// ============================================================================

function generateProveRepostDeletionInputs(parent: PostsFindUnique,
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

    return {
      transition: JSON.stringify(transition),
      signature: signatureBase58,
      targets: currentPosts.toString(),
      postState: JSON.stringify(parentState),
      targetWitness: JSON.stringify(parentWitness.toJSON()),
      currentAllRepostsCounter: currentAllRepostsCounter.toString(),
      usersRepostsCounters: usersRepostsCounters.toString(),
      targetsRepostsCounters: targetsRepostsCounters.toString(),
      initialReposts: initialReposts.toString(),
      latestReposts: latestReposts.toString(),
      initialRepostState: JSON.stringify(initialRepostState),
      repostWitness: JSON.stringify(repostWitness.toJSON()),
      deletionBlockHeight: deletionBlockHeight.toString()
    }
}

// ============================================================================

function generateProveRepostRestoration(parent: PostsFindUnique,
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

    return {
      transition: JSON.stringify(transition),
      signature: signatureBase58,
      targets: currentPosts.toString(),
      postState: JSON.stringify(parentState),
      targetWitness: JSON.stringify(parentWitness.toJSON()),
      currentAllRepostsCounter: currentAllRepostsCounter.toString(),
      usersRepostsCounters: usersRepostsCounters.toString(),
      targetsRepostsCounters: targetsRepostsCounters.toString(),
      initialReposts: initialReposts.toString(),
      latestReposts: latestReposts.toString(),
      initialRepostState: JSON.stringify(initialRepostState),
      repostWitness: JSON.stringify(repostWitness.toJSON()),
      restorationBlockHeight: newRestorationBlockHeight.toString()
    }
}

// ============================================================================

function generateReactionDeletionInputs(parent: PostsFindUnique,
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

function generateReactionRestorationInputs(parent: PostsFindUnique,
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

type ProvePostInputs = {
  signature: string,
  transition: string,
  postState: string,
  initialUsersPostsCounters: string,
  latestUsersPostsCounters: string,
  initialPosts: string,
  latestPosts: string,
  userPostsCounterWitness: string,
  postWitness: string
}

type ProveCommentInputs = {
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
}

type ProvePostUpdateInputs = {
  transition: string,
  signature: string,
  currentAllPostsCounter: string,
  usersPostsCounters: string,
  initialPosts: string,
  latestPosts: string,
  initialPostState: string,
  postWitness: string,
  blockHeight: string
}

type ProveCommentsUpdateInputs = {
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
  blockHeight: string
}

// ============================================================================

type PostsFindMany = Prisma.PromiseReturnType<typeof prisma.posts.findMany>;
type CommentsFindMany = Prisma.PromiseReturnType<typeof prisma.comments.findMany>;

type PostsFindUnique = Prisma.PromiseReturnType<typeof prisma.posts.findUnique>;
type CommentsFindUnique = Prisma.PromiseReturnType<typeof prisma.comments.findUnique>;

// ============================================================================

async function assertPostsOnchainAndServerState(pendingPosts: PostsFindMany, blockHeight: bigint) {

  const allPostsCounterFetch = await postsContract.allPostsCounter.fetch();
  console.log('allPostsCounterFetch: ' + allPostsCounterFetch!.toString());
  const usersPostsCountersFetch = await postsContract.usersPostsCounters.fetch();
  console.log('usersPostsCountersFetch: ' + usersPostsCountersFetch!.toString());
  const postsFetch = await postsContract.posts.fetch();
  console.log('postsFetch: ' + postsFetch!.toString());

  const allPostsCounterAfter = Field(postsContext.totalNumberOfPosts);
  console.log('allPostsCounterAfter: ' + allPostsCounterAfter.toString());
  const usersPostsCountersAfter = usersPostsCountersMap.getRoot();
  console.log('usersPostsCountersAfter: ' + usersPostsCountersAfter.toString());
  const postsAfter = postsMap.getRoot();
  console.log('postsAfter: ' + postsAfter.toString());

  const allPostsCounterEqual = allPostsCounterFetch!.equals(allPostsCounterAfter).toBoolean();
  console.log('allPostsCounterEqual: ' + allPostsCounterEqual);
  const usersPostsCountersEqual = usersPostsCountersFetch!.equals(usersPostsCountersAfter).toBoolean();
  console.log('usersPostsCountersEqual: ' + usersPostsCountersEqual);
  const postsEqual = postsFetch!.equals(postsAfter).toBoolean();
  console.log('postsEqual: ' + postsEqual);

  const isUpdated = allPostsCounterEqual && usersPostsCountersEqual && postsEqual;

  if (isUpdated) {
    for (const pPost of pendingPosts) {
      if (pPost.status === 'creating') {
        await prisma.posts.update({
          where: {
            postKey: pPost.postKey
          },
          data: {
            postBlockHeight: blockHeight,
            status: 'loading'
          }
        });
      } else if (pPost.status === 'deleting') {
        await prisma.posts.update({
          where: {
            postKey: pPost.postKey
          },
          data: {
            deletionBlockHeight: blockHeight,
            status: 'loading'
          }
        });
      } else if (pPost.status === 'restoring') {
        await prisma.posts.update({
          where: {
            postKey: pPost.postKey
          },
          data: {
            deletionBlockHeight: 0,
            restorationBlockHeight: blockHeight,
            status: 'loading'
          }
        });
      }
    }
  } else {
    throw new OnchainAndServerStateMismatchError('There is a mismatch between Posts onchain and server state');
  }
}

// ============================================================================

async function assertCommentsOnchainAndServerState(pendingComments: CommentsFindMany, blockHeight: bigint) {

  const allCommentsCounterFetch = await commentsContract.allCommentsCounter.fetch();
  console.log('allCommentsCounterFetch: ' + allCommentsCounterFetch!.toString());
  const usersCommentsCountersFetch = await commentsContract.usersCommentsCounters.fetch();
  console.log('usersCommentsCountersFetch: ' + usersCommentsCountersFetch!.toString());
  const targetsCommentsCountersFetch = await commentsContract.targetsCommentsCounters.fetch();
  console.log('targetsCommentsCountersFetch: ' + targetsCommentsCountersFetch!.toString());
  const commentsFetch = await commentsContract.comments.fetch();
  console.log('commentsFetch: ' + commentsFetch!.toString());

  const allCommentsCounterAfter = Field(commentsContext.totalNumberOfComments);
  console.log('allCommentsCounterAfter: ' + allCommentsCounterAfter.toString());
  const usersCommentsCountersAfter = usersCommentsCountersMap.getRoot();
  console.log('usersCommentsCountersAfter: ' + usersCommentsCountersAfter.toString());
  const targetsCommentsCountersAfter = targetsCommentsCountersMap.getRoot();
  console.log('targetsCommentsCountersAfter: ' + targetsCommentsCountersAfter.toString());
  const commentsAfter = commentsMap.getRoot();
  console.log('commentsAfter: ' + commentsAfter.toString());

  const allCommentsCounterEqual = allCommentsCounterFetch!.equals(allCommentsCounterAfter).toBoolean();
  console.log('allCommentsCounterEqual: ' + allCommentsCounterEqual);
  const usersCommentsCountersEqual = usersCommentsCountersFetch!.equals(usersCommentsCountersAfter).toBoolean();
  console.log('usersCommentsCountersEqual: ' + usersCommentsCountersEqual);
  const targetsCommentsCountersEqual = targetsCommentsCountersFetch!.equals(targetsCommentsCountersAfter).toBoolean();
  console.log('targetsCommentsCountersEqual: ' + targetsCommentsCountersEqual);
  const commentsEqual = commentsFetch!.equals(commentsAfter).toBoolean();
  console.log('commentsEqual: ' + commentsEqual);

  const isUpdated = allCommentsCounterEqual && usersCommentsCountersEqual && targetsCommentsCountersEqual && commentsEqual;

  if (isUpdated) {
    for (const pComment of pendingComments) {
      if (pComment.status === 'creating') {
        await prisma.comments.update({
          where: {
            commentKey: pComment.commentKey
          },
          data: {
            commentBlockHeight: blockHeight,
            status: 'loading'
          }
        });
      } else if (pComment.status === 'deleting') {
        await prisma.comments.update({
          where: {
            commentKey: pComment.commentKey
          },
          data: {
            deletionBlockHeight: blockHeight,
            status: 'loading'
          }
        });
      } else if (pComment.status === 'restoring') {
        await prisma.comments.update({
          where: {
            commentKey: pComment.commentKey
          },
          data: {
            deletionBlockHeight: 0,
            restorationBlockHeight: blockHeight,
            status: 'loading'
          }
        });
      }
    }
  } else {
    throw new OnchainAndServerStateMismatchError('There is a mismatch between Comments onchain and server state');
  }
}

// ============================================================================

async function resetServerPostPublicationsState(pendingPosts: PostsFindMany) {
  console.log('Current number of posts: ' + postsContext.totalNumberOfPosts);
  postsContext.totalNumberOfPosts -= pendingPosts.length;
  console.log('Restored number of posts: ' + postsContext.totalNumberOfPosts);

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
    console.log('Current usersPostsCountersMap root: ' + usersPostsCountersMap.getRoot().toString());
    usersPostsCountersMap.set(
      Poseidon.hash(PublicKey.fromBase58(poster).toFields()),
      Field(userPosts.length)
    );
    console.log('Restored usersPostsCountersMap root: ' + usersPostsCountersMap.getRoot().toString());
  };

  pendingPosts.forEach( pPost => {
    console.log('Current postsMap root: ' + postsMap.getRoot().toString());
    postsMap.set(
        Field(pPost.postKey),
        Field(0)
    );
    console.log('Restored postsMap root: ' + postsMap.getRoot().toString());
  });
}

// ============================================================================

async function resetServerCommentPublicationsState(pendingComments: CommentsFindMany) {
  console.log('Current number of comments: ' + commentsContext.totalNumberOfComments);
  commentsContext.totalNumberOfComments -= pendingComments.length;
  console.log('Restored number of comments: ' + commentsContext.totalNumberOfComments);

  const pendingCommenters = new Set(pendingComments.map( comment => comment.commenterAddress));
  for (const commenter of pendingCommenters) {
    const userComments = await prisma.comments.findMany({
      where: { commenterAddress: commenter,
        commentBlockHeight: {
          not: 0
        }
      },
      select: { userCommentsCounter: true }
    });
    console.log('Current usersCommentsCountersMap root: ' + usersCommentsCountersMap.getRoot().toString());
    usersCommentsCountersMap.set(
      Poseidon.hash(PublicKey.fromBase58(commenter).toFields()),
      Field(userComments.length)
    );
    console.log('Restored usersCommentsCountersMap root: ' + usersCommentsCountersMap.getRoot().toString());
  };

  const pendingTargets = new Set(pendingComments.map( comment => comment.targetKey));
  for (const target of pendingTargets) {
    const targetComments = await prisma.comments.findMany({
      where: { targetKey: target,
        commentBlockHeight: {
          not: 0
        }
      },
      select: { targetCommentsCounter: true }
    });
    console.log('Current targetsCommentsCountersMap root: ' + targetsCommentsCountersMap.getRoot().toString());
    targetsCommentsCountersMap.set(
      Field(target),
      Field(targetComments.length)
    );
    console.log('Restored targetsCommentsCountersMap root: ' + targetsCommentsCountersMap.getRoot().toString());
  };

  pendingComments.forEach( pComment => {
    console.log('Current commentsMap root: ' + commentsMap.getRoot().toString());
    commentsMap.set(
        Field(pComment.commentKey),
        Field(0)
    );
    console.log('Restored commentsMap root: ' + commentsMap.getRoot().toString());
  });
}

// ============================================================================

function resetServerPostUpdatesState(pendingPostUpdates: PostsFindMany) {
  for (const pendingPostUpdate of pendingPostUpdates) {
    const posterAddress = PublicKey.fromBase58(pendingPostUpdate!.posterAddress);
    const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
    const postContentID = CircuitString.fromString(pendingPostUpdate!.postContentID);

    const restoredPostState = new PostState({
      posterAddress: posterAddress,
      postContentID: postContentID,
      allPostsCounter: Field(pendingPostUpdate!.allPostsCounter),
      userPostsCounter: Field(pendingPostUpdate!.userPostsCounter),
      postBlockHeight: Field(pendingPostUpdate!.postBlockHeight),
      deletionBlockHeight: Field(pendingPostUpdate!.deletionBlockHeight),
      restorationBlockHeight: Field(pendingPostUpdate!.restorationBlockHeight)
    });

    console.log('Current postsMap root: ' + postsMap.getRoot().toString());
    postsMap.set(
        Poseidon.hash([posterAddressAsField, postContentID.hash()]),
        restoredPostState.hash()
    );
    console.log('Restored postsMap root: ' + postsMap.getRoot().toString());
  }
}

// ============================================================================

function resetServerCommentUpdatesState(pendingCommentUpdates: CommentsFindMany) {
  for (const pendingCommentUpdate of pendingCommentUpdates) {
    const commenterAddress = PublicKey.fromBase58(pendingCommentUpdate!.commenterAddress);
    const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
    const commentContentID = CircuitString.fromString(pendingCommentUpdate!.commentContentID);

    const restoredCommentState = new CommentState({
      isTargetPost: Bool(pendingCommentUpdate!.isTargetPost),
      targetKey: Field(pendingCommentUpdate!.targetKey),
      commenterAddress: commenterAddress,
      commentContentID: commentContentID,
      allCommentsCounter: Field(pendingCommentUpdate!.allCommentsCounter),
      userCommentsCounter: Field(pendingCommentUpdate!.userCommentsCounter),
      commentBlockHeight: Field(pendingCommentUpdate!.commentBlockHeight),
      targetCommentsCounter: Field(pendingCommentUpdate!.targetCommentsCounter),
      deletionBlockHeight: Field(pendingCommentUpdate!.deletionBlockHeight),
      restorationBlockHeight: Field(pendingCommentUpdate!.restorationBlockHeight)
    });

    console.log('Current commentsMap root: ' + commentsMap.getRoot().toString());
    commentsMap.set(
      Poseidon.hash([Field(pendingCommentUpdate!.targetKey), commenterAddressAsField, commentContentID.hash()]),
      restoredCommentState.hash()
    );
    console.log('Restored commentsMap root: ' + commentsMap.getRoot().toString());
  }
}

// ============================================================================

async function getTransactionStatus(pendingTransaction: Mina.PendingTransaction) {
  if (pendingTransaction.status === 'pending') {
    try {
      await pendingTransaction.wait({ maxAttempts: MAX_ATTEMPTS, interval: INTERVAL });
      console.log('Transaction successfully included in a block');
      return 'confirmed';
    } catch (error: any) {
      if ( error.message.includes('Exceeded max attempts') ) {
        return 'pending';
      } else {
        console.log(error.message);
        return 'rejected';
      }
    }
  } else {
    console.error('Transaction was not accepted for processing by the Mina daemon');
    return 'rejected';
  }
}

// ============================================================================