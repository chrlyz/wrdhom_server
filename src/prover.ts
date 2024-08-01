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

const postsContext = {
  prisma: prisma,
  usersPostsCountersMap: usersPostsCountersMap,
  postsMap: postsMap,
  totalNumberOfPosts: 0
}

await regeneratePostsZkAppState(postsContext);

const usersReactionsCountersMap = new MerkleMap();
const targetsReactionsCountersMap =  new MerkleMap();
const reactionsMap = new MerkleMap();

const reactionsContext = {
  prisma: prisma,
  usersReactionsCountersMap: usersReactionsCountersMap,
  targetsReactionsCountersMap: targetsReactionsCountersMap,
  reactionsMap: reactionsMap,
  totalNumberOfReactions: 0
}

await regenerateReactionsZkAppState(reactionsContext);

const usersCommentsCountersMap = new MerkleMap();
const targetsCommentsCountersMap =  new MerkleMap();
const commentsMap = new MerkleMap();

const commentsContext = {
  prisma: prisma,
  usersCommentsCountersMap: usersCommentsCountersMap,
  targetsCommentsCountersMap: targetsCommentsCountersMap,
  commentsMap: commentsMap,
  totalNumberOfComments: 0
}

await regenerateCommentsZkAppState(commentsContext);

const usersRepostsCountersMap = new MerkleMap();
const targetsRepostsCountersMap =  new MerkleMap();
const repostsMap = new MerkleMap();

const repostsContext = {
  prisma: prisma,
  usersRepostsCountersMap: usersRepostsCountersMap,
  targetsRepostsCountersMap: targetsRepostsCountersMap,
  repostsMap: repostsMap,
  totalNumberOfReposts: 0
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
    let provePostPublicationsInputs: ProvePostPublicationInputs[] = [];

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
        const result = generateProvePostPublicationInputs(
          pPost.pendingSignature!,
          pPost.posterAddress,
          pPost.postContentID,
          pPost.allPostsCounter,
          pPost.userPostsCounter,
          pPost.pendingBlockHeight!,
          pPost.deletionBlockHeight,
          pPost.restorationBlockHeight
        );
        provePostPublicationsInputs.push(result);
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
      provePostPublicationsInputs.length = 0;
      for (const pPost of pendingPosts) {
        const result = generateProvePostPublicationInputs(
          pPost.pendingSignature!,
          pPost.posterAddress,
          pPost.postContentID,
          pPost.allPostsCounter,
          pPost.userPostsCounter,
          currentBlockHeight,
          pPost.deletionBlockHeight,
          pPost.restorationBlockHeight
        );
        provePostPublicationsInputs.push(result);
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
      for (const provePostPublicationInputs of provePostPublicationsInputs) {
        const job = await postsQueue.add(
          `job`,
          { provePostPublicationInputs: provePostPublicationInputs }
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

    let pendingReactions: ReactionsFindMany;
    let proveReactionPublicationsInputs: ProveReactionPublicationInputs[] = [];

    // Get actions that may have a pending associated transaction
    pendingReactions = await prisma.reactions.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
      orderBy: {
          allReactionsCounter: 'asc'
      },
      where: {
          status: 'creating'
      }
    });

    // If there isn't a pending transaction, process new actions
    if (pendingReactions.length === 0) {
      pendingReactions = await prisma.reactions.findMany({
        take: Number(process.env.PARALLEL_NUMBER),
        orderBy: {
            allReactionsCounter: 'asc'
        },
        where: {
            status: 'create'
        }
      });
      // Handle possible pending transaction confirmation or failure
    } else {
      reactionsContext.totalNumberOfReactions += pendingReactions.length;
      for (const pReaction of pendingReactions) {
        const result = await generateProveReactionPublicationInputs(
          pReaction.isTargetPost,
          pReaction.targetKey,
          pReaction.reactorAddress,
          pReaction.reactionCodePoint,
          pReaction.allReactionsCounter,
          pReaction.userReactionsCounter,
          pReaction.targetReactionsCounter,
          pReaction.pendingBlockHeight!,
          pReaction.deletionBlockHeight,
          pReaction.restorationBlockHeight,
          pReaction.pendingSignature!
        );
        proveReactionPublicationsInputs.push(result);
      }
      
      try {
        /* If a pending transaction was confirmed, syncing onchain and server state,
          restart loop to process new actions
        */
        console.log('Syncing onchain and server state since last reaction publications:');
        await assertReactionsOnchainAndServerState(pendingReactions, pendingReactions[0].pendingBlockHeight!);
        continue;
      } catch (error) {
          /* If a pending transaction hasn't been successfully confirmed,
            reset server state to process the pending actions with a new blockheight
          */
         if (error instanceof OnchainAndServerStateMismatchError) {
          await resetServerReactionPublicationsState(pendingReactions);
         } else {
          throw error;
         }
      }
    }

    if (pendingReactions.length !== 0) {
      reactionsContext.totalNumberOfReactions += pendingReactions.length;
      const lastBlock = await fetchLastBlock(configReactions.url);
      const currentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log('Current blockheight for reaction publications: ' + currentBlockHeight);
      proveReactionPublicationsInputs.length = 0;
      for (const pReaction of pendingReactions) {
        const result = await generateProveReactionPublicationInputs(
          pReaction.isTargetPost,
          pReaction.targetKey,
          pReaction.reactorAddress,
          pReaction.reactionCodePoint,
          pReaction.allReactionsCounter,
          pReaction.userReactionsCounter,
          pReaction.targetReactionsCounter,
          currentBlockHeight,
          pReaction.deletionBlockHeight,
          pReaction.restorationBlockHeight,
          pReaction.pendingSignature!
        );
        proveReactionPublicationsInputs.push(result);
        pReaction.status = 'creating';
        await prisma.reactions.update({
          where: {
            reactionKey: pReaction.reactionKey
          },
          data: {
            status: 'creating',
            pendingBlockHeight: currentBlockHeight
          }
        });
      }

      const jobsPromises: Promise<any>[] = [];
      for (const proveReactionPublicationInputs of proveReactionPublicationsInputs) {
        const job = await reactionsQueue.add(
          `job`,
          { proveReactionPublicationInputs: proveReactionPublicationInputs }
        );
        jobsPromises.push(job.waitUntilFinished(reactionsQueueEvents));
      }

      startTime = performance.now();
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
      console.log(`Created ${pendingReactions.length} proofs in ${(endTime - startTime)/1000/60} minutes`);
    
      startTime = performance.now();
      const pendingTransaction = await updateReactionsOnChainState(transitionsAndProofs);
      endTime = performance.now();
      console.log(`Merged ${pendingReactions.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      console.log('Confirming reaction publications transaction...');
      let status = 'pending';
      while (status === 'pending') {
        status = await getTransactionStatus(pendingTransaction);
      }
      endTime = performance.now();
      console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);

      if (status === 'rejected') {
        await resetServerReactionPublicationsState(pendingReactions);
        continue;
      }

      await assertReactionsOnchainAndServerState(pendingReactions, currentBlockHeight);
    }

  } else if (provingTurn === provingComments) {

    let pendingComments: CommentsFindMany;
    let proveCommentPublicationsInputs: ProveCommentPublicationInputs[] = [];

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
        const result = await generateProveCommentPublicationInputs(
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
        proveCommentPublicationsInputs.push(result);
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
      proveCommentPublicationsInputs.length = 0;
      for (const pComment of pendingComments) {
        const result = await generateProveCommentPublicationInputs(
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
        proveCommentPublicationsInputs.push(result);
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
      for (const proveCommentPublicationInputs of proveCommentPublicationsInputs) {
        const job = await commentsQueue.add(
          `job`,
          { proveCommentPublicationInputs: proveCommentPublicationInputs }
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

    let pendingReposts: RepostsFindMany;
    let proveRepostPublicationsInputs: ProveRepostPublicationInputs[] = [];

    // Get actions that may have a pending associated transaction
    pendingReposts = await prisma.reposts.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
      orderBy: {
          allRepostsCounter: 'asc'
      },
      where: {
          status: 'creating'
      }
    });

    // If there isn't a pending transaction, process new actions
    if (pendingReposts.length === 0) {
      pendingReposts = await prisma.reposts.findMany({
        take: Number(process.env.PARALLEL_NUMBER),
        orderBy: {
            allRepostsCounter: 'asc'
        },
        where: {
            status: 'create'
        }
      });
      // Handle possible pending transaction confirmation or failure
    } else {
      repostsContext.totalNumberOfReposts += pendingReposts.length;
      for (const pRepost of pendingReposts) {
        const result = await generateProveRepostPublicationInputs(
          pRepost.isTargetPost,
          pRepost.targetKey,
          pRepost.reposterAddress,
          pRepost.allRepostsCounter,
          pRepost.userRepostsCounter,
          pRepost.targetRepostsCounter,
          pRepost.pendingBlockHeight!,
          pRepost.deletionBlockHeight,
          pRepost.restorationBlockHeight,
          pRepost.pendingSignature!
        );
        proveRepostPublicationsInputs.push(result);
      }
      
      try {
        /* If a pending transaction was confirmed, syncing onchain and server state,
          restart loop to process new actions
        */
        console.log('Syncing onchain and server state since last repost publications:');
        await assertRepostsOnchainAndServerState(pendingReposts, pendingReposts[0].pendingBlockHeight!);
        continue;
      } catch (error) {
          /* If a pending transaction hasn't been successfully confirmed,
            reset server state to process the pending actions with a new blockheight
          */
         if (error instanceof OnchainAndServerStateMismatchError) {
          await resetServerRepostPublicationsState(pendingReposts);
         } else {
          throw error;
         }
      }
    }

    if (pendingReposts.length !== 0) {
      repostsContext.totalNumberOfReposts += pendingReposts.length;
      const lastBlock = await fetchLastBlock(configReposts.url);
      const currentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log('Current blockheight for repost publications: ' + currentBlockHeight);
      proveRepostPublicationsInputs.length = 0;
      for (const pRepost of pendingReposts) {
        const result = await generateProveRepostPublicationInputs(
          pRepost.isTargetPost,
          pRepost.targetKey,
          pRepost.reposterAddress,
          pRepost.allRepostsCounter,
          pRepost.userRepostsCounter,
          pRepost.targetRepostsCounter,
          currentBlockHeight,
          pRepost.deletionBlockHeight,
          pRepost.restorationBlockHeight,
          pRepost.pendingSignature!
        );
        proveRepostPublicationsInputs.push(result);
        pRepost.status = 'creating';
        await prisma.reposts.update({
          where: {
            repostKey: pRepost.repostKey
          },
          data: {
            status: 'creating',
            pendingBlockHeight: currentBlockHeight
          }
        });
      }

      const jobsPromises: Promise<any>[] = [];
      for (const proveRepostPublicationInputs of proveRepostPublicationsInputs) {
        const job = await repostsQueue.add(
          `job`,
          { proveRepostPublicationInputs: proveRepostPublicationInputs }
        );
        jobsPromises.push(job.waitUntilFinished(repostsQueueEvents));
      }

      startTime = performance.now();
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
      console.log(`Created ${pendingReposts.length} proofs in ${(endTime - startTime)/1000/60} minutes`);
    
      startTime = performance.now();
      const pendingTransaction = await updateRepostsOnChainState(transitionsAndProofs);
      endTime = performance.now();
      console.log(`Merged ${pendingReposts.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      console.log('Confirming repost publications transaction...');
      let status = 'pending';
      while (status === 'pending') {
        status = await getTransactionStatus(pendingTransaction);
      }
      endTime = performance.now();
      console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);

      if (status === 'rejected') {
        await resetServerRepostPublicationsState(pendingReposts);
        continue;
      }

      await assertRepostsOnchainAndServerState(pendingReposts, currentBlockHeight);
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
         const result = generateProvePostDeletionInputs(
          pendingPostDeletion.posterAddress,
          pendingPostDeletion.postContentID,
          pendingPostDeletion.allPostsCounter,
          pendingPostDeletion.userPostsCounter,
          pendingPostDeletion.postBlockHeight,
          pendingPostDeletion.restorationBlockHeight,
          Field(pendingPostDeletion.postKey),
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
         const result = generateProvePostDeletionInputs(
          pendingPostDeletion.posterAddress,
          pendingPostDeletion.postContentID,
          pendingPostDeletion.allPostsCounter,
          pendingPostDeletion.userPostsCounter,
          pendingPostDeletion.postBlockHeight,
          pendingPostDeletion.restorationBlockHeight,
          Field(pendingPostDeletion.postKey),
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
        const result = generateProvePostRestorationInputs(
          pendingPostRestoration.posterAddress,
          pendingPostRestoration.postContentID,
          pendingPostRestoration.allPostsCounter,
          pendingPostRestoration.userPostsCounter,
          pendingPostRestoration.postBlockHeight,
          pendingPostRestoration.deletionBlockHeight,
          pendingPostRestoration.restorationBlockHeight,
          Field(pendingPostRestoration.postKey),
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
        const result = generateProvePostRestorationInputs(
          pendingPostRestoration.posterAddress,
          pendingPostRestoration.postContentID,
          pendingPostRestoration.allPostsCounter,
          pendingPostRestoration.userPostsCounter,
          pendingPostRestoration.postBlockHeight,
          pendingPostRestoration.deletionBlockHeight,
          pendingPostRestoration.restorationBlockHeight,
          Field(pendingPostRestoration.postKey),
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
    let proveCommentDeletionsInputs: ProveCommentUpdateInputs[] = [];

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
            postKey: pendingCommentDeletion.targetKey
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
            postKey: pendingCommentDeletion.targetKey
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
    let proveCommentRestorationsInputs: ProveCommentUpdateInputs[] = [];

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
            postKey: pendingCommentRestoration.targetKey
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
            postKey: pendingCommentRestoration.targetKey
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

    let pendingRepostDeletions: RepostsFindMany;
    let proveRepostDeletionsInputs: ProveRepostUpdateInputs[] = [];

    // Get actions that may have a pending associated transaction
    pendingRepostDeletions = await prisma.reposts.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
      orderBy: {
          allRepostsCounter: 'asc'
      },
      where: {
          status: 'deleting'
      }
    });

    // If there isn't a pending transaction, process new actions
    if (pendingRepostDeletions.length === 0) {
      pendingRepostDeletions = await prisma.reposts.findMany({
        take: Number(process.env.PARALLEL_NUMBER),
        orderBy: {
            allRepostsCounter: 'asc'
        },
        where: {
            status: 'delete'
        }
      });
      // Handle possible pending transaction confirmation or failure
    } else {
      for (const pendingRepostDeletion of pendingRepostDeletions) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingRepostDeletion.targetKey
          }
        });

        const result = generateProveRepostDeletionInputs(
          parent,
          pendingRepostDeletion.isTargetPost,
          pendingRepostDeletion.targetKey,
          pendingRepostDeletion.reposterAddress,
          pendingRepostDeletion.allRepostsCounter,
          pendingRepostDeletion.userRepostsCounter,
          pendingRepostDeletion.targetRepostsCounter,
          pendingRepostDeletion.repostBlockHeight,
          pendingRepostDeletion.restorationBlockHeight,
          Field(pendingRepostDeletion.repostKey),
          pendingRepostDeletion.pendingSignature!,
          Field(pendingRepostDeletion.pendingBlockHeight!),
          Field(repostsContext.totalNumberOfReposts)
        );
        proveRepostDeletionsInputs.push(result);
      }
      
      try {
        /* If a pending transaction was confirmed, syncing onchain and server state,
          restart loop to process new actions
        */
        console.log('Syncing onchain and server state since last repost deletions:');
        await assertRepostsOnchainAndServerState(pendingRepostDeletions, pendingRepostDeletions[0].pendingBlockHeight!);
        continue;
      } catch (error) {
          /* If a pending transaction hasn't been successfully confirmed,
            reset server state to process the pending actions with a new blockheight
          */
        if (error instanceof OnchainAndServerStateMismatchError) {
          resetServerRepostUpdatesState(pendingRepostDeletions);
        } else {
          throw error;
        }
      }
    }

    if (pendingRepostDeletions.length !== 0) {
      const lastBlock = await fetchLastBlock(configReposts.url);
      const currentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log('Current blockheight for repost deletions: ' + currentBlockHeight);
      proveRepostDeletionsInputs.length = 0;
      for (const pendingRepostDeletion of pendingRepostDeletions) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingRepostDeletion.targetKey
          }
        });

        const result = generateProveRepostDeletionInputs(
          parent,
          pendingRepostDeletion.isTargetPost,
          pendingRepostDeletion.targetKey,
          pendingRepostDeletion.reposterAddress,
          pendingRepostDeletion.allRepostsCounter,
          pendingRepostDeletion.userRepostsCounter,
          pendingRepostDeletion.targetRepostsCounter,
          pendingRepostDeletion.repostBlockHeight,
          pendingRepostDeletion.restorationBlockHeight,
          Field(pendingRepostDeletion.repostKey),
          pendingRepostDeletion.pendingSignature!,
          Field(currentBlockHeight),
          Field(repostsContext.totalNumberOfReposts)
        );
        proveRepostDeletionsInputs.push(result);
        pendingRepostDeletion.status = 'deleting';
        await prisma.reposts.update({
          where: {
            repostKey: pendingRepostDeletion.repostKey
          },
          data: {
            status: 'deleting',
            pendingBlockHeight: currentBlockHeight
          }
        });
      }

      const jobsPromises: Promise<any>[] = [];
      for (const proveRepostDeletionInputs of proveRepostDeletionsInputs) {
        const job = await repostDeletionsQueue.add(
          `job`,
          { proveRepostDeletionInputs: proveRepostDeletionInputs }
        );
        jobsPromises.push(job.waitUntilFinished(repostDeletionsQueueEvents));
      }

      startTime = performance.now();
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
      console.log(`Created ${pendingRepostDeletions.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      const pendingTransaction = await updateRepostsOnChainState(transitionsAndProofs);
      endTime = performance.now();
      console.log(`Merged ${pendingRepostDeletions.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      console.log('Confirming repost deletions transaction...');
      let status = 'pending';
      while (status === 'pending') {
        status = await getTransactionStatus(pendingTransaction);
      }
      endTime = performance.now();
      console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);

      if (status === 'rejected') {
        resetServerRepostUpdatesState(pendingRepostDeletions);
        continue;
      }

      await assertRepostsOnchainAndServerState(pendingRepostDeletions, currentBlockHeight);
    }
   
  } else if (provingTurn === provingRepostRestorations) {

    let pendingRepostRestorations: RepostsFindMany;
    let proveRepostRestorationsInputs: ProveRepostUpdateInputs[] = [];

    // Get actions that may have a pending associated transaction
    pendingRepostRestorations = await prisma.reposts.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
      orderBy: {
          allRepostsCounter: 'asc'
      },
      where: {
          status: 'restoring'
      }
    });

    // If there isn't a pending transaction, process new actions
    if (pendingRepostRestorations.length === 0) {
      pendingRepostRestorations = await prisma.reposts.findMany({
        take: Number(process.env.PARALLEL_NUMBER),
        orderBy: {
            allRepostsCounter: 'asc'
        },
        where: {
            status: 'restore'
        }
      });
      // Handle possible pending transaction confirmation or failure
    } else {
      for (const pendingRepostRestoration of pendingRepostRestorations) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingRepostRestoration.targetKey
          }
        });

        const result = generateProveRepostRestorationInputs(
          parent,
          pendingRepostRestoration.isTargetPost,
          pendingRepostRestoration.targetKey,
          pendingRepostRestoration.reposterAddress,
          pendingRepostRestoration.allRepostsCounter,
          pendingRepostRestoration.userRepostsCounter,
          pendingRepostRestoration.targetRepostsCounter,
          pendingRepostRestoration.repostBlockHeight,
          pendingRepostRestoration.deletionBlockHeight,
          pendingRepostRestoration.restorationBlockHeight,
          Field(pendingRepostRestoration.repostKey),
          pendingRepostRestoration.pendingSignature!,
          Field(pendingRepostRestoration.pendingBlockHeight!),
          Field(repostsContext.totalNumberOfReposts)
        );
        proveRepostRestorationsInputs.push(result);
      }
      
      try {
        /* If a pending transaction was confirmed, syncing onchain and server state,
          restart loop to process new actions
        */
        console.log('Syncing onchain and server state since last repost restorations:');
        await assertRepostsOnchainAndServerState(pendingRepostRestorations, pendingRepostRestorations[0].pendingBlockHeight!);
        continue;
      } catch (error) {
          /* If a pending transaction hasn't been successfully confirmed,
            reset server state to process the pending actions with a new blockheight
          */
        if (error instanceof OnchainAndServerStateMismatchError) {
          resetServerRepostUpdatesState(pendingRepostRestorations);
        } else {
          throw error;
        }
      }
    }

    if (pendingRepostRestorations.length !== 0) {
      const lastBlock = await fetchLastBlock(configReposts.url);
      const currentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log('Current blockheight for repost restorations: ' + currentBlockHeight);
      proveRepostRestorationsInputs.length = 0;
      for (const pendingRepostRestoration of pendingRepostRestorations) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingRepostRestoration.targetKey
          }
        });

        const result = generateProveRepostRestorationInputs(
          parent,
          pendingRepostRestoration.isTargetPost,
          pendingRepostRestoration.targetKey,
          pendingRepostRestoration.reposterAddress,
          pendingRepostRestoration.allRepostsCounter,
          pendingRepostRestoration.userRepostsCounter,
          pendingRepostRestoration.targetRepostsCounter,
          pendingRepostRestoration.repostBlockHeight,
          pendingRepostRestoration.deletionBlockHeight,
          pendingRepostRestoration.restorationBlockHeight,
          Field(pendingRepostRestoration.repostKey),
          pendingRepostRestoration.pendingSignature!,
          Field(currentBlockHeight),
          Field(repostsContext.totalNumberOfReposts)
        );
        proveRepostRestorationsInputs.push(result);
        pendingRepostRestoration.status = 'restoring';
        await prisma.reposts.update({
          where: {
            repostKey: pendingRepostRestoration.repostKey
          },
          data: {
            status: 'restoring',
            pendingBlockHeight: currentBlockHeight
          }
        });
      }

      const jobsPromises: Promise<any>[] = [];
      for (const proveRepostRestorationInputs of proveRepostRestorationsInputs) {
        const job = await repostRestorationsQueue.add(
          `job`,
          { proveRepostRestorationInputs: proveRepostRestorationInputs }
        );
        jobsPromises.push(job.waitUntilFinished(repostRestorationsQueueEvents));
      }

      startTime = performance.now();
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
      console.log(`Created ${pendingRepostRestorations.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      const pendingTransaction = await updateRepostsOnChainState(transitionsAndProofs);
      endTime = performance.now();
      console.log(`Merged ${pendingRepostRestorations.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      console.log('Confirming repost restorations transaction...');
      let status = 'pending';
      while (status === 'pending') {
        status = await getTransactionStatus(pendingTransaction);
      }
      endTime = performance.now();
      console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);

      if (status === 'rejected') {
        resetServerRepostUpdatesState(pendingRepostRestorations);
        continue;
      }

      await assertRepostsOnchainAndServerState(pendingRepostRestorations, currentBlockHeight);
    }
   
  } else if (provingTurn === provingReactionDeletions) {

    let pendingReactionDeletions: ReactionsFindMany;
    let proveReactionDeletionsInputs: ProveReactionUpdateInputs[] = [];

    // Get actions that may have a pending associated transaction
    pendingReactionDeletions = await prisma.reactions.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
      orderBy: {
          allReactionsCounter: 'asc'
      },
      where: {
          status: 'deleting'
      }
    });

    // If there isn't a pending transaction, process new actions
    if (pendingReactionDeletions.length === 0) {
      pendingReactionDeletions = await prisma.reactions.findMany({
        take: Number(process.env.PARALLEL_NUMBER),
        orderBy: {
            allReactionsCounter: 'asc'
        },
        where: {
            status: 'delete'
        }
      });
      // Handle possible pending transaction confirmation or failure
    } else {
      for (const pendingReactionDeletion of pendingReactionDeletions) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingReactionDeletion.targetKey
          }
        });

        const result = generateProveReactionDeletionInputs(
          parent,
          pendingReactionDeletion.isTargetPost,
          pendingReactionDeletion.targetKey,
          pendingReactionDeletion.reactorAddress,
          pendingReactionDeletion.reactionCodePoint,
          pendingReactionDeletion.allReactionsCounter,
          pendingReactionDeletion.userReactionsCounter,
          pendingReactionDeletion.targetReactionsCounter,
          pendingReactionDeletion.reactionBlockHeight,
          pendingReactionDeletion.restorationBlockHeight,
          Field(pendingReactionDeletion.reactionKey),
          pendingReactionDeletion.pendingSignature!,
          Field(pendingReactionDeletion.pendingBlockHeight!),
          Field(reactionsContext.totalNumberOfReactions)
        );
        proveReactionDeletionsInputs.push(result);
      }
      
      try {
        /* If a pending transaction was confirmed, syncing onchain and server state,
          restart loop to process new actions
        */
        console.log('Syncing onchain and server state since last reaction deletions:');
        await assertReactionsOnchainAndServerState(pendingReactionDeletions, pendingReactionDeletions[0].pendingBlockHeight!);
        continue;
      } catch (error) {
          /* If a pending transaction hasn't been successfully confirmed,
            reset server state to process the pending actions with a new blockheight
          */
         if (error instanceof OnchainAndServerStateMismatchError) {
          resetServerReactionUpdatesState(pendingReactionDeletions);
         } else {
          throw error;
         }
      }
    }

    if (pendingReactionDeletions.length !== 0) {
      const lastBlock = await fetchLastBlock(configReactions.url);
      const currentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log('Current blockheight for reaction deletions: ' + currentBlockHeight);
      proveReactionDeletionsInputs.length = 0;
      for (const pendingReactionDeletion of pendingReactionDeletions) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingReactionDeletion.targetKey
          }
        });

        const result = generateProveReactionDeletionInputs(
          parent,
          pendingReactionDeletion.isTargetPost,
          pendingReactionDeletion.targetKey,
          pendingReactionDeletion.reactorAddress,
          pendingReactionDeletion.reactionCodePoint,
          pendingReactionDeletion.allReactionsCounter,
          pendingReactionDeletion.userReactionsCounter,
          pendingReactionDeletion.targetReactionsCounter,
          pendingReactionDeletion.reactionBlockHeight,
          pendingReactionDeletion.restorationBlockHeight,
          Field(pendingReactionDeletion.reactionKey),
          pendingReactionDeletion.pendingSignature!,
          Field(currentBlockHeight),
          Field(reactionsContext.totalNumberOfReactions)
        );
        proveReactionDeletionsInputs.push(result);
        pendingReactionDeletion.status = 'deleting';
        await prisma.reactions.update({
          where: {
            reactionKey: pendingReactionDeletion.reactionKey
          },
          data: {
            status: 'deleting',
            pendingBlockHeight: currentBlockHeight
          }
        });
      }

      const jobsPromises: Promise<any>[] = [];
      for (const proveReactionDeletionInputs of proveReactionDeletionsInputs) {
        const job = await reactionDeletionsQueue.add(
          `job`,
          { proveReactionDeletionInputs: proveReactionDeletionInputs }
        );
        jobsPromises.push(job.waitUntilFinished(reactionDeletionsQueueEvents));
      }

      startTime = performance.now();
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
      console.log(`Created ${pendingReactionDeletions.length} proofs in ${(endTime - startTime)/1000/60} minutes`);
    
      startTime = performance.now();
      const pendingTransaction = await updateReactionsOnChainState(transitionsAndProofs);
      endTime = performance.now();
      console.log(`Merged ${pendingReactionDeletions.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      console.log('Confirming reaction deletions transaction...');
      let status = 'pending';
      while (status === 'pending') {
        status = await getTransactionStatus(pendingTransaction);
      }
      endTime = performance.now();
      console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);

      if (status === 'rejected') {
        resetServerReactionUpdatesState(pendingReactionDeletions);
        continue;
      }

      await assertReactionsOnchainAndServerState(pendingReactionDeletions, currentBlockHeight);
    }
    
  } else if (provingTurn === provingReactionRestorations) {

    let pendingReactionRestorations: ReactionsFindMany;
    let proveReactionRestorationsInputs: ProveReactionUpdateInputs[] = [];

    // Get actions that may have a pending associated transaction
    pendingReactionRestorations = await prisma.reactions.findMany({
      take: Number(process.env.PARALLEL_NUMBER),
      orderBy: {
          allReactionsCounter: 'asc'
      },
      where: {
          status: 'restoring'
      }
    });

    // If there isn't a pending transaction, process new actions
    if (pendingReactionRestorations.length === 0) {
      pendingReactionRestorations = await prisma.reactions.findMany({
        take: Number(process.env.PARALLEL_NUMBER),
        orderBy: {
            allReactionsCounter: 'asc'
        },
        where: {
            status: 'restore'
        }
      });
      // Handle possible pending transaction confirmation or failure
    } else {
      for (const pendingReactionRestoration of pendingReactionRestorations) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingReactionRestoration.targetKey
          }
        });

        const result = generateProveReactionRestorationInputs(
          parent,
          pendingReactionRestoration.isTargetPost,
          pendingReactionRestoration.targetKey,
          pendingReactionRestoration.reactorAddress,
          pendingReactionRestoration.reactionCodePoint,
          pendingReactionRestoration.allReactionsCounter,
          pendingReactionRestoration.userReactionsCounter,
          pendingReactionRestoration.targetReactionsCounter,
          pendingReactionRestoration.reactionBlockHeight,
          pendingReactionRestoration.deletionBlockHeight,
          pendingReactionRestoration.restorationBlockHeight,
          Field(pendingReactionRestoration.reactionKey),
          pendingReactionRestoration.pendingSignature!,
          Field(pendingReactionRestoration.pendingBlockHeight!),
          Field(reactionsContext.totalNumberOfReactions)
        );
        proveReactionRestorationsInputs.push(result);
      }
      
      try {
        /* If a pending transaction was confirmed, syncing onchain and server state,
          restart loop to process new actions
        */
        console.log('Syncing onchain and server state since last reaction restorations:');
        await assertReactionsOnchainAndServerState(pendingReactionRestorations, pendingReactionRestorations[0].pendingBlockHeight!);
        continue;
      } catch (error) {
          /* If a pending transaction hasn't been successfully confirmed,
            reset server state to process the pending actions with a new blockheight
          */
        if (error instanceof OnchainAndServerStateMismatchError) {
          resetServerReactionUpdatesState(pendingReactionRestorations);
        } else {
          throw error;
        }
      }
    }

    if (pendingReactionRestorations.length !== 0) {
      const lastBlock = await fetchLastBlock(configReactions.url);
      const currentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log('Current blockheight for reaction restorations: ' + currentBlockHeight);
      proveReactionRestorationsInputs.length = 0;
      for (const pendingReactionRestoration of pendingReactionRestorations) {
        const parent = await prisma.posts.findUnique({
          where: {
            postKey: pendingReactionRestoration.targetKey
          }
        });

        const result = generateProveReactionRestorationInputs(
          parent,
          pendingReactionRestoration.isTargetPost,
          pendingReactionRestoration.targetKey,
          pendingReactionRestoration.reactorAddress,
          pendingReactionRestoration.reactionCodePoint,
          pendingReactionRestoration.allReactionsCounter,
          pendingReactionRestoration.userReactionsCounter,
          pendingReactionRestoration.targetReactionsCounter,
          pendingReactionRestoration.reactionBlockHeight,
          pendingReactionRestoration.deletionBlockHeight,
          pendingReactionRestoration.restorationBlockHeight,
          Field(pendingReactionRestoration.reactionKey),
          pendingReactionRestoration.pendingSignature!,
          Field(currentBlockHeight),
          Field(reactionsContext.totalNumberOfReactions)
        );
        proveReactionRestorationsInputs.push(result);
        pendingReactionRestoration.status = 'restoring';
        await prisma.reactions.update({
          where: {
            reactionKey: pendingReactionRestoration.reactionKey
          },
          data: {
            status: 'restoring',
            pendingBlockHeight: currentBlockHeight
          }
        });
      }

      const jobsPromises: Promise<any>[] = [];
      for (const proveReactionRestorationInputs of proveReactionRestorationsInputs) {
        const job = await reactionRestorationsQueue.add(
          `job`,
          { proveReactionRestorationInputs: proveReactionRestorationInputs }
        );
        jobsPromises.push(job.waitUntilFinished(reactionRestorationsQueueEvents));
      }

      startTime = performance.now();
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
      console.log(`Created ${pendingReactionRestorations.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      const pendingTransaction = await updateReactionsOnChainState(transitionsAndProofs);
      endTime = performance.now();
      console.log(`Merged ${pendingReactionRestorations.length} proofs in ${(endTime - startTime)/1000/60} minutes`);

      startTime = performance.now();
      console.log('Confirming reaction restorations transaction...');
      let status = 'pending';
      while (status === 'pending') {
        status = await getTransactionStatus(pendingTransaction);
      }
      endTime = performance.now();
      console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);

      if (status === 'rejected') {
        resetServerReactionUpdatesState(pendingReactionRestorations);
        continue;
      }

      await assertReactionsOnchainAndServerState(pendingReactionRestorations, currentBlockHeight);
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

function generateProvePostPublicationInputs(signatureBase58: string, posterAddressBase58: string,
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

async function generateProveReactionPublicationInputs(isTargetPost: boolean, targetKey: string,
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

async function generateProveCommentPublicationInputs(isTargetPost: boolean, targetKey: string,
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

async function generateProveRepostPublicationInputs(isTargetPost: boolean, targetKey: string,
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

function generateProvePostDeletionInputs(posterAddressBase58: string,
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

function generateProvePostRestorationInputs(posterAddressBase58: string,
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
    console.log('Repost deletion transition created');

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
      blockHeight: deletionBlockHeight.toString()
    }
}

// ============================================================================

function generateProveRepostRestorationInputs(parent: PostsFindUnique,
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
    console.log('Repost restoration transition created');

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
      blockHeight: newRestorationBlockHeight.toString()
    }
}

// ============================================================================

function generateProveReactionDeletionInputs(parent: PostsFindUnique,
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
    console.log('Reaction deletion transition created');
    
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
      blockHeight: deletionBlockHeight.toString()
    }
}

// ============================================================================

function generateProveReactionRestorationInputs(parent: PostsFindUnique,
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
    console.log('Reaction restoration transition created');

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
      blockHeight: newRestorationBlockHeight.toString()
    }
}

// ============================================================================

  async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================

type ProvePostPublicationInputs = {
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

type ProveCommentPublicationInputs = {
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

type ProveReactionPublicationInputs = {
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
}

type ProveRepostPublicationInputs = {
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

type ProveCommentUpdateInputs = {
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

type ProveReactionUpdateInputs = {
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
  blockHeight: string
}

type ProveRepostUpdateInputs = {
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
  blockHeight: string
}

// ============================================================================

type PostsFindMany = Prisma.PromiseReturnType<typeof prisma.posts.findMany>;
type CommentsFindMany = Prisma.PromiseReturnType<typeof prisma.comments.findMany>;
type ReactionsFindMany = Prisma.PromiseReturnType<typeof prisma.reactions.findMany>;
type RepostsFindMany = Prisma.PromiseReturnType<typeof prisma.reposts.findMany>;

type PostsFindUnique = Prisma.PromiseReturnType<typeof prisma.posts.findUnique>;

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

async function assertReactionsOnchainAndServerState(pendingReactions: ReactionsFindMany, blockHeight: bigint) {

  const allReactionsCounterFetch = await reactionsContract.allReactionsCounter.fetch();
  console.log('allReactionsCounterFetch: ' + allReactionsCounterFetch!.toString());
  const usersReactionsCountersFetch = await reactionsContract.usersReactionsCounters.fetch();
  console.log('usersReactionsCountersFetch: ' + usersReactionsCountersFetch!.toString());
  const targetsReactionsCountersFetch = await reactionsContract.targetsReactionsCounters.fetch();
  console.log('targetsReactionsCountersFetch: ' + targetsReactionsCountersFetch!.toString());
  const reactionsFetch = await reactionsContract.reactions.fetch();
  console.log('reactionsFetch: ' + reactionsFetch!.toString());

  const allReactionsCounterAfter = Field(reactionsContext.totalNumberOfReactions);
  console.log('allReactionsCounterAfter: ' + allReactionsCounterAfter.toString());
  const usersReactionsCountersAfter = usersReactionsCountersMap.getRoot();
  console.log('usersReactionsCountersAfter: ' + usersReactionsCountersAfter.toString());
  const targetsReactionsCountersAfter = targetsReactionsCountersMap.getRoot();
  console.log('targetsReactionsCountersAfter: ' + targetsReactionsCountersAfter.toString());
  const reactionsAfter = reactionsMap.getRoot();
  console.log('reactionsAfter: ' + reactionsAfter.toString());

  const allReactionsCounterEqual = allReactionsCounterFetch!.equals(allReactionsCounterAfter).toBoolean();
  console.log('allReactionsCounterEqual: ' + allReactionsCounterEqual);
  const usersReactionsCountersEqual = usersReactionsCountersFetch!.equals(usersReactionsCountersAfter).toBoolean();
  console.log('usersReactionsCountersEqual: ' + usersReactionsCountersEqual);
  const targetsReactionsCountersEqual = targetsReactionsCountersFetch!.equals(targetsReactionsCountersAfter).toBoolean();
  console.log('targetsReactionsCountersEqual: ' + targetsReactionsCountersEqual);
  const reactionsEqual = reactionsFetch!.equals(reactionsAfter).toBoolean();
  console.log('reactionsEqual: ' + reactionsEqual);

  const isUpdated = allReactionsCounterEqual && usersReactionsCountersEqual && targetsReactionsCountersEqual && reactionsEqual;

  if (isUpdated) {
    for (const pReaction of pendingReactions) {
      if (pReaction.status === 'creating') {
        await prisma.reactions.update({
          where: {
            reactionKey: pReaction.reactionKey
          },
          data: {
            reactionBlockHeight: blockHeight,
            status: 'loading'
          }
        });
      } else if (pReaction.status === 'deleting') {
        await prisma.reactions.update({
          where: {
            reactionKey: pReaction.reactionKey
          },
          data: {
            deletionBlockHeight: blockHeight,
            status: 'loading'
          }
        });
      } else if (pReaction.status === 'restoring') {
        await prisma.reactions.update({
          where: {
            reactionKey: pReaction.reactionKey
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
    throw new OnchainAndServerStateMismatchError('There is a mismatch between Reactions onchain and server state');
  }
}

// ============================================================================

async function assertRepostsOnchainAndServerState(pendingReposts: RepostsFindMany, blockHeight: bigint) {

  const allRepostsCounterFetch = await repostsContract.allRepostsCounter.fetch();
  console.log('allRepostsCounterFetch: ' + allRepostsCounterFetch!.toString());
  const usersRepostsCountersFetch = await repostsContract.usersRepostsCounters.fetch();
  console.log('usersRepostsCountersFetch: ' + usersRepostsCountersFetch!.toString());
  const targetsRepostsCountersFetch = await repostsContract.targetsRepostsCounters.fetch();
  console.log('targetsRepostsCountersFetch: ' + targetsRepostsCountersFetch!.toString());
  const repostsFetch = await repostsContract.reposts.fetch();
  console.log('repostsFetch: ' + repostsFetch!.toString());

  const allRepostsCounterAfter = Field(repostsContext.totalNumberOfReposts);
  console.log('allRepostsCounterAfter: ' + allRepostsCounterAfter.toString());
  const usersRepostsCountersAfter = usersRepostsCountersMap.getRoot();
  console.log('usersRepostsCountersAfter: ' + usersRepostsCountersAfter.toString());
  const targetsRepostsCountersAfter = targetsRepostsCountersMap.getRoot();
  console.log('targetsRepostsCountersAfter: ' + targetsRepostsCountersAfter.toString());
  const repostsAfter = repostsMap.getRoot();
  console.log('repostsAfter: ' + repostsAfter.toString());

  const allRepostsCounterEqual = allRepostsCounterFetch!.equals(allRepostsCounterAfter).toBoolean();
  console.log('allRepostsCounterEqual: ' + allRepostsCounterEqual);
  const usersRepostsCountersEqual = usersRepostsCountersFetch!.equals(usersRepostsCountersAfter).toBoolean();
  console.log('usersRepostsCountersEqual: ' + usersRepostsCountersEqual);
  const targetsRepostsCountersEqual = targetsRepostsCountersFetch!.equals(targetsRepostsCountersAfter).toBoolean();
  console.log('targetsRepostsCountersEqual: ' + targetsRepostsCountersEqual);
  const repostsEqual = repostsFetch!.equals(repostsAfter).toBoolean();
  console.log('repostsEqual: ' + repostsEqual);

  const isUpdated = allRepostsCounterEqual && usersRepostsCountersEqual && targetsRepostsCountersEqual && repostsEqual;

  if (isUpdated) {
    for (const pRepost of pendingReposts) {
      if (pRepost.status === 'creating') {
        await prisma.reposts.update({
          where: {
            repostKey: pRepost.repostKey
          },
          data: {
            repostBlockHeight: blockHeight,
            status: 'loading'
          }
        });
      } else if (pRepost.status === 'deleting') {
        await prisma.reposts.update({
          where: {
            repostKey: pRepost.repostKey
          },
          data: {
            deletionBlockHeight: blockHeight,
            status: 'loading'
          }
        });
      } else if (pRepost.status === 'restoring') {
        await prisma.reposts.update({
          where: {
            repostKey: pRepost.repostKey
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
    throw new OnchainAndServerStateMismatchError('There is a mismatch between Reposts onchain and server state');
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

async function resetServerReactionPublicationsState(pendingReactions: ReactionsFindMany) {
  console.log('Current number of reactions: ' + reactionsContext.totalNumberOfReactions);
  reactionsContext.totalNumberOfReactions -= pendingReactions.length;
  console.log('Restored number of reactions: ' + reactionsContext.totalNumberOfReactions);

  const pendingReactioners = new Set(pendingReactions.map( reaction => reaction.reactorAddress));
  for (const reactioner of pendingReactioners) {
    const userReactions = await prisma.reactions.findMany({
      where: { reactorAddress: reactioner,
        reactionBlockHeight: {
          not: 0
        }
      },
      select: { userReactionsCounter: true }
    });
    console.log('Current usersReactionsCountersMap root: ' + usersReactionsCountersMap.getRoot().toString());
    usersReactionsCountersMap.set(
      Poseidon.hash(PublicKey.fromBase58(reactioner).toFields()),
      Field(userReactions.length)
    );
    console.log('Restored usersReactionsCountersMap root: ' + usersReactionsCountersMap.getRoot().toString());
  };

  const pendingTargets = new Set(pendingReactions.map( reaction => reaction.targetKey));
  for (const target of pendingTargets) {
    const targetReactions = await prisma.reactions.findMany({
      where: { targetKey: target,
        reactionBlockHeight: {
          not: 0
        }
      },
      select: { targetReactionsCounter: true }
    });
    console.log('Current targetsReactionsCountersMap root: ' + targetsReactionsCountersMap.getRoot().toString());
    targetsReactionsCountersMap.set(
      Field(target),
      Field(targetReactions.length)
    );
    console.log('Restored targetsReactionsCountersMap root: ' + targetsReactionsCountersMap.getRoot().toString());
  };

  pendingReactions.forEach( pReaction => {
    console.log('Current reactionsMap root: ' + reactionsMap.getRoot().toString());
    reactionsMap.set(
        Field(pReaction.reactionKey),
        Field(0)
    );
    console.log('Restored reactionsMap root: ' + reactionsMap.getRoot().toString());
  });
}

// ============================================================================

async function resetServerRepostPublicationsState(pendingReposts: RepostsFindMany) {
  console.log('Current number of reposts: ' + repostsContext.totalNumberOfReposts);
  repostsContext.totalNumberOfReposts -= pendingReposts.length;
  console.log('Restored number of reposts: ' + repostsContext.totalNumberOfReposts);

  const pendingReposters = new Set(pendingReposts.map( repost => repost.reposterAddress));
  for (const reposter of pendingReposters) {
    const userReposts = await prisma.reposts.findMany({
      where: { reposterAddress: reposter,
        repostBlockHeight: {
          not: 0
        }
      },
      select: { userRepostsCounter: true }
    });
    console.log('Current usersRepostsCountersMap root: ' + usersRepostsCountersMap.getRoot().toString());
    usersRepostsCountersMap.set(
      Poseidon.hash(PublicKey.fromBase58(reposter).toFields()),
      Field(userReposts.length)
    );
    console.log('Restored usersRepostsCountersMap root: ' + usersRepostsCountersMap.getRoot().toString());
  };

  const pendingTargets = new Set(pendingReposts.map( repost => repost.targetKey));
  for (const target of pendingTargets) {
    const targetReposts = await prisma.reposts.findMany({
      where: { targetKey: target,
        repostBlockHeight: {
          not: 0
        }
      },
      select: { targetRepostsCounter: true }
    });
    console.log('Current targetsRepostsCountersMap root: ' + targetsRepostsCountersMap.getRoot().toString());
    targetsRepostsCountersMap.set(
      Field(target),
      Field(targetReposts.length)
    );
    console.log('Restored targetsRepostsCountersMap root: ' + targetsRepostsCountersMap.getRoot().toString());
  };

  pendingReposts.forEach( pRepost => {
    console.log('Current repostsMap root: ' + repostsMap.getRoot().toString());
    repostsMap.set(
        Field(pRepost.repostKey),
        Field(0)
    );
    console.log('Restored repostsMap root: ' + repostsMap.getRoot().toString());
  });
}

// ============================================================================

function resetServerPostUpdatesState(pendingPostUpdates: PostsFindMany) {
  for (const pendingPostUpdate of pendingPostUpdates) {
    const posterAddress = PublicKey.fromBase58(pendingPostUpdate.posterAddress);
    const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
    const postContentID = CircuitString.fromString(pendingPostUpdate.postContentID);

    const restoredPostState = new PostState({
      posterAddress: posterAddress,
      postContentID: postContentID,
      allPostsCounter: Field(pendingPostUpdate.allPostsCounter),
      userPostsCounter: Field(pendingPostUpdate.userPostsCounter),
      postBlockHeight: Field(pendingPostUpdate.postBlockHeight),
      deletionBlockHeight: Field(pendingPostUpdate.deletionBlockHeight),
      restorationBlockHeight: Field(pendingPostUpdate.restorationBlockHeight)
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
    const commenterAddress = PublicKey.fromBase58(pendingCommentUpdate.commenterAddress);
    const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
    const commentContentID = CircuitString.fromString(pendingCommentUpdate.commentContentID);

    const restoredCommentState = new CommentState({
      isTargetPost: Bool(pendingCommentUpdate.isTargetPost),
      targetKey: Field(pendingCommentUpdate.targetKey),
      commenterAddress: commenterAddress,
      commentContentID: commentContentID,
      allCommentsCounter: Field(pendingCommentUpdate.allCommentsCounter),
      userCommentsCounter: Field(pendingCommentUpdate.userCommentsCounter),
      commentBlockHeight: Field(pendingCommentUpdate.commentBlockHeight),
      targetCommentsCounter: Field(pendingCommentUpdate.targetCommentsCounter),
      deletionBlockHeight: Field(pendingCommentUpdate.deletionBlockHeight),
      restorationBlockHeight: Field(pendingCommentUpdate.restorationBlockHeight)
    });

    console.log('Current commentsMap root: ' + commentsMap.getRoot().toString());
    commentsMap.set(
      Poseidon.hash([Field(pendingCommentUpdate.targetKey), commenterAddressAsField, commentContentID.hash()]),
      restoredCommentState.hash()
    );
    console.log('Restored commentsMap root: ' + commentsMap.getRoot().toString());
  }
}

// ============================================================================

function resetServerReactionUpdatesState(pendingReactionUpdates: ReactionsFindMany) {
  for (const pendingReactionUpdate of pendingReactionUpdates) {
    const reactorAddress = PublicKey.fromBase58(pendingReactionUpdate.reactorAddress);
    const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
    const reactionCodePoint = Field(pendingReactionUpdate.reactionCodePoint);

    const restoredReactionState = new ReactionState({
      isTargetPost: Bool(pendingReactionUpdate.isTargetPost),
      targetKey: Field(pendingReactionUpdate.targetKey),
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePoint,
      allReactionsCounter: Field(pendingReactionUpdate.allReactionsCounter),
      userReactionsCounter: Field(pendingReactionUpdate.userReactionsCounter),
      reactionBlockHeight: Field(pendingReactionUpdate.reactionBlockHeight),
      targetReactionsCounter: Field(pendingReactionUpdate.targetReactionsCounter),
      deletionBlockHeight: Field(pendingReactionUpdate.deletionBlockHeight),
      restorationBlockHeight: Field(pendingReactionUpdate.restorationBlockHeight)
    });

    console.log('Current reactionsMap root: ' + reactionsMap.getRoot().toString());
    reactionsMap.set(
      Poseidon.hash([Field(pendingReactionUpdate.targetKey), reactorAddressAsField, reactionCodePoint]),
      restoredReactionState.hash()
    );
    console.log('Restored reactionsMap root: ' + reactionsMap.getRoot().toString());
  }
}

// ============================================================================

function resetServerRepostUpdatesState(pendingRepostUpdates: RepostsFindMany) {
  for (const pendingRepostUpdate of pendingRepostUpdates) {
    const reposterAddress = PublicKey.fromBase58(pendingRepostUpdate.reposterAddress);
    const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());

    const restoredRepostState = new RepostState({
      isTargetPost: Bool(pendingRepostUpdate.isTargetPost),
      targetKey: Field(pendingRepostUpdate.targetKey),
      reposterAddress: reposterAddress,
      allRepostsCounter: Field(pendingRepostUpdate.allRepostsCounter),
      userRepostsCounter: Field(pendingRepostUpdate.userRepostsCounter),
      repostBlockHeight: Field(pendingRepostUpdate.repostBlockHeight),
      targetRepostsCounter: Field(pendingRepostUpdate.targetRepostsCounter),
      deletionBlockHeight: Field(pendingRepostUpdate.deletionBlockHeight),
      restorationBlockHeight: Field(pendingRepostUpdate.restorationBlockHeight)
    });

    console.log('Current repostsMap root: ' + repostsMap.getRoot().toString());
    repostsMap.set(
      Poseidon.hash([Field(pendingRepostUpdate.targetKey), reposterAddressAsField]),
      restoredRepostState.hash()
    );
    console.log('Restored repostsMap root: ' + repostsMap.getRoot().toString());
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