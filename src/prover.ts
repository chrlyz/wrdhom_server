import { CircuitString, PublicKey, Signature, fetchLastBlock,
  MerkleMap, Field, Poseidon, Mina, PrivateKey,
  fetchAccount, Bool, checkZkappTransaction } from 'o1js';
import { Config, PostState, PostsTransition, Posts,
  PostsContract, PostsProof, ReactionState,
  ReactionsTransition, Reactions, ReactionsContract,
  ReactionsProof, CommentState, CommentsTransition, Comments,
  CommentsContract, CommentsProof, Reposts, RepostsContract,
  RepostsTransition, RepostsProof, RepostState
} from 'wrdhom';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';
import { PrismaClient, Prisma, status_enum } from '@prisma/client';
import {
  regenerateCommentsZkAppState,
  regeneratePostsZkAppState,
  regenerateReactionsZkAppState,
  regenerateRepostsZkAppState,
  getLastPostsState,
  getLastReactionsState,
  getLastCommentsState,
  getLastRepostsState
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

let startTime = performance.now();
console.log('Compiling Posts ZkProgram...');
await Posts.compile();
console.log('Compiling PostsContract...');
await PostsContract.compile();
console.log('Compiling Reactions ZkProgram...');
await Reactions.compile();
console.log('Compiling ReactionsContract...');
await ReactionsContract.compile();
console.log('Compiling Comments ZkProgram...');
await Comments.compile();
console.log('Compiling CommentsContract...');
await CommentsContract.compile();
console.log('Compiling Reposts ZkProgram...');
await Reposts.compile();
console.log('Compiling RepostsContract...');
await RepostsContract.compile();
console.log('Compiled');
let endTime = performance.now();
console.log(`${(endTime - startTime)/1000/60} minutes`);

// Regenerate Merkle maps from database

const usersPostsCountersMap = new MerkleMap();
const postsMap = new MerkleMap();
const postsStateHistoryMap = new MerkleMap();

const postsContext = {
  prisma: prisma,
  usersPostsCountersMap: usersPostsCountersMap,
  postsMap: postsMap,
  totalNumberOfPosts: 0,
  postsLastUpdate: 0,
  postsStateHistoryMap: postsStateHistoryMap
}

await regeneratePostsZkAppState(postsContext);

const usersReactionsCountersMap = new MerkleMap();
const targetsReactionsCountersMap =  new MerkleMap();
const reactionsMap = new MerkleMap();
const reactionsStateHistoryMap = new MerkleMap();

const reactionsContext = {
  prisma: prisma,
  usersReactionsCountersMap: usersReactionsCountersMap,
  targetsReactionsCountersMap: targetsReactionsCountersMap,
  reactionsMap: reactionsMap,
  totalNumberOfReactions: 0,
  reactionsLastUpdate: 0,
  reactionsStateHistoryMap: reactionsStateHistoryMap
}

await regenerateReactionsZkAppState(reactionsContext);

const usersCommentsCountersMap = new MerkleMap();
const targetsCommentsCountersMap =  new MerkleMap();
const commentsMap = new MerkleMap();
const commentsStateHistoryMap = new MerkleMap();

const commentsContext = {
  prisma: prisma,
  usersCommentsCountersMap: usersCommentsCountersMap,
  targetsCommentsCountersMap: targetsCommentsCountersMap,
  commentsMap: commentsMap,
  totalNumberOfComments: 0,
  commentsLastUpdate: 0,
  commentsStateHistoryMap: commentsStateHistoryMap
}

await regenerateCommentsZkAppState(commentsContext);

const usersRepostsCountersMap = new MerkleMap();
const targetsRepostsCountersMap =  new MerkleMap();
const repostsMap = new MerkleMap();
const repostsStateHistoryMap = new MerkleMap();

const repostsContext = {
  prisma: prisma,
  usersRepostsCountersMap: usersRepostsCountersMap,
  targetsRepostsCountersMap: targetsRepostsCountersMap,
  repostsMap: repostsMap,
  totalNumberOfReposts: 0,
  repostsLastUpdate: 0,
  repostsStateHistoryMap: commentsStateHistoryMap
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

const BLOCKCHAIN_LENGTH = 290;
const DELAY = 10000;

const PARALLEL_NUMBER = Number(process.env.PARALLEL_NUMBER) || 3;
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS) || 60;
const INTERVAL = Number(process.env.INTERVAL) || 10000;

while (true) {
  if (provingTurn === provingPosts) {

    let pendingPosts: PostsFindMany;

    // Get actions that may have a pending associated transaction
    pendingPosts = await getPendingActions(prisma.posts, 'allPostsCounter', 'creating');

    // If there isn't a pending transaction, process new actions
    if (pendingPosts.length === 0) {
      pendingPosts = await getPendingActions(prisma.posts, 'allPostsCounter', 'create');

    // Handle possible pending transaction confirmation or failure
    } else {
        const confirmed = await handlePendingTransaction(
          pendingPosts,
          postsContext,
          generateProvePostPublicationInputs,
          assertPostsOnchainAndServerState,
          'creating'
        )
        if (confirmed) continue;
    }

    if (pendingPosts.length !== 0) {
      await processPendingActions(
        postsContext,
        pendingPosts,
        generateProvePostPublicationInputs,
        postsQueue,
        postsQueueEvents,
        updatePostsOnChainState,
        prisma.posts,
        assertPostsOnchainAndServerState,
        resetServerPostPublicationsState,
        'creating'
      )
    }

  } else if (provingTurn === provingReactions) {

    let pendingReactions: ReactionsFindMany;

    // Get actions that may have a pending associated transaction
    pendingReactions = await getPendingActions(prisma.reactions, 'allReactionsCounter', 'creating');
    // If there isn't a pending transaction, process new actions
    if (pendingReactions.length === 0) {
      pendingReactions = await getPendingActions(prisma.reactions, 'allReactionsCounter', 'create');
      // Handle possible pending transaction confirmation or failure
    } else {
        const confirmed = await handlePendingTransaction(
          pendingReactions,
          reactionsContext,
          generateProveReactionPublicationInputs,
          assertReactionsOnchainAndServerState,
          'creating'
        )
        if (confirmed) continue;
    }

    if (pendingReactions.length !== 0) {
      await processPendingActions(
        reactionsContext,
        pendingReactions,
        generateProveReactionPublicationInputs,
        reactionsQueue,
        reactionsQueueEvents,
        updateReactionsOnChainState,
        prisma.reactions,
        assertReactionsOnchainAndServerState,
        resetServerReactionPublicationsState,
        'creating'
      )
    }

  } else if (provingTurn === provingComments) {

    let pendingComments: CommentsFindMany;

    // Get actions that may have a pending associated transaction
    pendingComments = await getPendingActions(prisma.comments, 'allCommentsCounter', 'creating');

    // If there isn't a pending transaction, process new actions
    if (pendingComments.length === 0) {
      pendingComments = await getPendingActions(prisma.comments, 'allCommentsCounter', 'create');
      // Handle possible pending transaction confirmation or failure
    } else {
      const confirmed = await handlePendingTransaction(
        pendingComments,
        commentsContext,
        generateProveCommentPublicationInputs,
        assertCommentsOnchainAndServerState,
        'creating'
      )
      if (confirmed) continue;
    }

    if (pendingComments.length !== 0) {
      await processPendingActions(
        commentsContext,
        pendingComments,
        generateProveCommentPublicationInputs,
        commentsQueue,
        commentsQueueEvents,
        updateCommentsOnChainState,
        prisma.comments,
        assertCommentsOnchainAndServerState,
        resetServerCommentPublicationsState,
        'creating'
      )
    }

  } else if (provingTurn === provingReposts) {

    let pendingReposts: RepostsFindMany;

    // Get actions that may have a pending associated transaction
    pendingReposts = await getPendingActions(prisma.reposts, 'allRepostsCounter', 'creating');

    // If there isn't a pending transaction, process new actions
    if (pendingReposts.length === 0) {
        pendingReposts = await getPendingActions(prisma.reposts, 'allRepostsCounter', 'create');
      // Handle possible pending transaction confirmation or failure
    } else {
        const confirmed = await handlePendingTransaction(
          pendingReposts,
          repostsContext,
          generateProveRepostPublicationInputs,
          assertRepostsOnchainAndServerState,
          'creating'
        )
        if (confirmed) continue;
    }

    if (pendingReposts.length !== 0) {
      await processPendingActions(
        repostsContext,
        pendingReposts,
        generateProveRepostPublicationInputs,
        repostsQueue,
        repostsQueueEvents,
        updateRepostsOnChainState,
        prisma.reposts,
        assertRepostsOnchainAndServerState,
        resetServerRepostPublicationsState,
        'creating'
      )
    }
  
  } else if (provingTurn === provingPostDeletions) {

     let pendingPostDeletions: PostsFindMany;
 
     // Get actions that may have a pending associated transaction
     pendingPostDeletions = await getPendingActions(prisma.posts, 'allPostsCounter', 'deleting');
 
     // If there isn't a pending transaction, process new actions
     if (pendingPostDeletions.length === 0) {
      pendingPostDeletions = await getPendingActions(prisma.posts, 'allPostsCounter', 'delete');
       // Handle possible pending transaction confirmation or failure
     } else {
        const confirmed = await handlePendingTransaction(
          pendingPostDeletions,
          postsContext,
          generateProvePostDeletionInputs,
          assertPostsOnchainAndServerState,
          'deleting'
        )
        if (confirmed) continue;
     }
 
     if (pendingPostDeletions.length !== 0) {
      await processPendingActions(
        postsContext,
        pendingPostDeletions,
        generateProvePostDeletionInputs,
        postDeletionsQueue,
        postDeletionsQueueEvents,
        updatePostsOnChainState,
        prisma.posts,
        assertPostsOnchainAndServerState,
        resetServerPostUpdatesState,
        'deleting'
      )
     }

  }  else if (provingTurn === provingPostRestorations) {


    let pendingPostRestorations: PostsFindMany;

    // Get actions that may have a pending associated transaction
    pendingPostRestorations = await getPendingActions(prisma.posts, 'allPostsCounter', 'restoring');

    // If there isn't a pending transaction, process new actions
    if (pendingPostRestorations.length === 0) {
      pendingPostRestorations = await getPendingActions(prisma.posts, 'allPostsCounter', 'restore');
      // Handle possible pending transaction confirmation or failure
    } else {
        const confirmed = await handlePendingTransaction(
          pendingPostRestorations,
          postsContext,
          generateProvePostRestorationInputs,
          assertPostsOnchainAndServerState,
          'restoring'
        )
        if (confirmed) continue;
    }

    if (pendingPostRestorations.length !== 0) {
      await processPendingActions(
        postsContext,
        pendingPostRestorations,
        generateProvePostRestorationInputs,
        postRestorationsQueue,
        postRestorationsQueueEvents,
        updatePostsOnChainState,
        prisma.posts,
        assertPostsOnchainAndServerState,
        resetServerPostUpdatesState,
        'restoring'
      )
    }

  } else if (provingTurn === provingCommentDeletions) {

    let pendingCommentDeletions: CommentsFindMany;

    // Get actions that may have a pending associated transaction
    pendingCommentDeletions = await getPendingActions(prisma.comments, 'allCommentsCounter', 'deleting');

    // If there isn't a pending transaction, process new actions
    if (pendingCommentDeletions.length === 0) {
      pendingCommentDeletions = await getPendingActions(prisma.comments, 'allCommentsCounter', 'delete');
      // Handle possible pending transaction confirmation or failure
    } else {
      const confirmed = await handlePendingTransaction(
        pendingCommentDeletions,
        commentsContext,
        generateProveCommentDeletionInputs,
        assertCommentsOnchainAndServerState,
        'deleting'
      )
      if (confirmed) continue;
    }

    if (pendingCommentDeletions.length !== 0) {
      await processPendingActions(
        commentsContext,
        pendingCommentDeletions,
        generateProveCommentDeletionInputs,
        commentDeletionsQueue,
        commentDeletionsQueueEvents,
        updateCommentsOnChainState,
        prisma.comments,
        assertCommentsOnchainAndServerState,
        resetServerCommentUpdatesState,
        'deleting'
      )
    }

  } else if (provingTurn === provingCommentRestorations) {

    let pendingCommentRestorations: CommentsFindMany;

    // Get actions that may have a pending associated transaction
    pendingCommentRestorations = await getPendingActions(prisma.comments, 'allCommentsCounter', 'restoring');

    // If there isn't a pending transaction, process new actions
    if (pendingCommentRestorations.length === 0) {
      pendingCommentRestorations = await getPendingActions(prisma.comments, 'allCommentsCounter', 'restore');
      // Handle possible pending transaction confirmation or failure
    } else {
        const confirmed = await handlePendingTransaction(
          pendingCommentRestorations,
          commentsContext,
          generateProveCommentRestorationInputs,
          assertCommentsOnchainAndServerState,
          'restoring'
        )
        if (confirmed) continue;
    }

    if (pendingCommentRestorations.length !== 0) {
      await processPendingActions(
        commentsContext,
        pendingCommentRestorations,
        generateProveCommentRestorationInputs,
        commentRestorationsQueue,
        commentRestorationsQueueEvents,
        updateCommentsOnChainState,
        prisma.comments,
        assertCommentsOnchainAndServerState,
        resetServerCommentUpdatesState,
        'restoring'
      )
    }

  } else if (provingTurn === provingRepostDeletions) {

    let pendingRepostDeletions: RepostsFindMany;

    // Get actions that may have a pending associated transaction
    pendingRepostDeletions = await getPendingActions(prisma.reposts, 'allRepostsCounter', 'deleting');

    // If there isn't a pending transaction, process new actions
    if (pendingRepostDeletions.length === 0) {
      pendingRepostDeletions = await getPendingActions(prisma.reposts, 'allRepostsCounter', 'delete');
      // Handle possible pending transaction confirmation or failure
    } else {
        const confirmed = await handlePendingTransaction(
          pendingRepostDeletions,
          repostsContext,
          generateProveRepostDeletionInputs,
          assertRepostsOnchainAndServerState,
          'deleting'
        )
        if (confirmed) continue;
    }

    if (pendingRepostDeletions.length !== 0) {
      await processPendingActions(
        repostsContext,
        pendingRepostDeletions,
        generateProveRepostDeletionInputs,
        repostDeletionsQueue,
        repostDeletionsQueueEvents,
        updateRepostsOnChainState,
        prisma.reposts,
        assertRepostsOnchainAndServerState,
        resetServerRepostUpdatesState,
        'deleting'
      )
    }
   
  } else if (provingTurn === provingRepostRestorations) {

    let pendingRepostRestorations: RepostsFindMany;

    // Get actions that may have a pending associated transaction
    pendingRepostRestorations = await getPendingActions(prisma.reposts, 'allRepostsCounter', 'restoring');

    // If there isn't a pending transaction, process new actions
    if (pendingRepostRestorations.length === 0) {
      pendingRepostRestorations = await getPendingActions(prisma.reposts, 'allRepostsCounter', 'restore');
      // Handle possible pending transaction confirmation or failure
    } else {
        const confirmed = await handlePendingTransaction(
          pendingRepostRestorations,
          repostsContext,
          generateProveRepostRestorationInputs,
          assertRepostsOnchainAndServerState,
          'restoring'
        )
        if (confirmed) continue;
    }

    if (pendingRepostRestorations.length !== 0) {
      await processPendingActions(
        repostsContext,
        pendingRepostRestorations,
        generateProveRepostRestorationInputs,
        repostRestorationsQueue,
        repostRestorationsQueueEvents,
        updateRepostsOnChainState,
        prisma.reposts,
        assertRepostsOnchainAndServerState,
        resetServerRepostUpdatesState,
        'restoring'
      );
    }
   
  } else if (provingTurn === provingReactionDeletions) {

    let pendingReactionDeletions: ReactionsFindMany;

    // Get actions that may have a pending associated transaction
    pendingReactionDeletions = await getPendingActions(prisma.reactions, 'allReactionsCounter', 'deleting');

    // If there isn't a pending transaction, process new actions
    if (pendingReactionDeletions.length === 0) {
      pendingReactionDeletions = await getPendingActions(prisma.reactions, 'allReactionsCounter', 'delete');
      // Handle possible pending transaction confirmation or failure
    } else {
        const confirmed = await handlePendingTransaction(
          pendingReactionDeletions,
          reactionsContext,
          generateProveReactionDeletionInputs,
          assertReactionsOnchainAndServerState,
          'deleting'
        )
        if (confirmed) continue;
    }

    if (pendingReactionDeletions.length !== 0) {
      await processPendingActions(
        reactionsContext,
        pendingReactionDeletions,
        generateProveReactionDeletionInputs,
        reactionDeletionsQueue,
        reactionDeletionsQueueEvents,
        updateReactionsOnChainState,
        prisma.reactions,
        assertReactionsOnchainAndServerState,
        resetServerReactionUpdatesState,
        'deleting'
      );
    }
    
  } else if (provingTurn === provingReactionRestorations) {

    let pendingReactionRestorations: ReactionsFindMany;

    // Get actions that may have a pending associated transaction
    pendingReactionRestorations = await getPendingActions(prisma.reactions, 'allReactionsCounter', 'restoring');

    // If there isn't a pending transaction, process new actions
    if (pendingReactionRestorations.length === 0) {
      pendingReactionRestorations = await getPendingActions(prisma.reactions, 'allReactionsCounter', 'restore');
      // Handle possible pending transaction confirmation or failure
    } else {
        const confirmed = await handlePendingTransaction(
          pendingReactionRestorations,
          reactionsContext,
          generateProveReactionRestorationInputs,
          assertReactionsOnchainAndServerState,
          'restoring'
        )
        if (confirmed) continue;
    }

    if (pendingReactionRestorations.length !== 0) {
      await processPendingActions(
        reactionsContext,
        pendingReactionRestorations,
        generateProveReactionRestorationInputs,
        reactionRestorationsQueue,
        reactionRestorationsQueueEvents,
        updateReactionsOnChainState,
        prisma.reactions,
        assertReactionsOnchainAndServerState,
        resetServerReactionUpdatesState,
        'restoring'
      );
    }
  }

  provingTurn++;
  if (provingTurn > provingReactionRestorations) {
    provingTurn = 0;
    console.log('Pause to wait for new actions before running loop again...');
    await delay(DELAY);
  }
}

// ============================================================================

function generateProvePostPublicationInputs(
  pendingPost: PostsFindUnique,
  currentBlockHeight: bigint = pendingPost?.pendingBlockHeight!
) {

  const signature = Signature.fromBase58(pendingPost?.pendingSignature!);
  const posterAddress = PublicKey.fromBase58(pendingPost?.posterAddress!);
  const postCIDAsCircuitString = CircuitString.fromString(pendingPost?.postContentID!);

      const postState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(pendingPost?.allPostsCounter!),
        userPostsCounter: Field(pendingPost?.userPostsCounter!),
        postBlockHeight: Field(currentBlockHeight),
        deletionBlockHeight: Field(pendingPost?.deletionBlockHeight!),
        restorationBlockHeight: Field(pendingPost?.restorationBlockHeight!)
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
        signature: pendingPost?.pendingSignature!,
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

  await deleteCandidatePostsStateHistoryStatus();

  const postsHashedStateWitness = await updateCandidatePostsStateHistoryStatus(
    result.transition.blockHeight,
    result.transition.latestAllPostsCounter,
    result.transition.latestUsersPostsCounters,
    result.transition.latestPosts
  );

  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    async () => {
      postsContract.update(result.proof, postsHashedStateWitness);
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

async function generateProveReactionPublicationInputs(
  pendingReaction: ReactionsFindUnique,
  currentBlockHeight: bigint = pendingReaction?.pendingBlockHeight!
) {

  const reactorAddress = PublicKey.fromBase58(pendingReaction?.reactorAddress!);
  const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
  const reactionCodePointAsField = Field(pendingReaction?.reactionCodePoint!);
  const targetKeyAsField = Field(pendingReaction?.targetKey!);
  const signature = Signature.fromBase58(pendingReaction?.pendingSignature!);

  const reactionState = new ReactionState({
    isTargetPost: Bool(pendingReaction?.isTargetPost!),
    targetKey: targetKeyAsField,
    reactorAddress: reactorAddress,
    reactionCodePoint: reactionCodePointAsField,
    allReactionsCounter: Field(pendingReaction?.allReactionsCounter!),
    userReactionsCounter: Field(pendingReaction?.userReactionsCounter!),
    targetReactionsCounter: Field(pendingReaction?.targetReactionsCounter!),
    reactionBlockHeight: Field(currentBlockHeight),
    deletionBlockHeight: Field(pendingReaction?.deletionBlockHeight!),
    restorationBlockHeight: Field(pendingReaction?.restorationBlockHeight!)
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
      postKey: pendingReaction?.targetKey
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
    signature: pendingReaction?.pendingSignature,
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

  await deleteCandidateReactionsStateHistoryStatus();

  const reactionsHashedStateWitness = await updateCandidateReactionsStateHistoryStatus(
    result.transition.blockHeight,
    result.transition.latestAllReactionsCounter,
    result.transition.latestUsersReactionsCounters,
    result.transition.latestTargetsReactionsCounters,
    result.transition.latestReactions
  );

  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    async () => {
      reactionsContract.update(result.proof, reactionsHashedStateWitness);
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

async function generateProveCommentPublicationInputs(
  pendingComment: CommentsFindUnique,
  currentBlockHeight: bigint = pendingComment?.pendingBlockHeight!
) {

  const commenterAddress = PublicKey.fromBase58(pendingComment?.commenterAddress!);
  const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
  const commentContentIDAsCS = CircuitString.fromString(pendingComment?.commentContentID!);
  const commentContentIDAsField = commentContentIDAsCS.hash();
  const targetKeyAsField = Field(pendingComment?.targetKey!);
  const signature = Signature.fromBase58(pendingComment?.pendingSignature!);

  const commentState = new CommentState({
    isTargetPost: Bool(pendingComment?.isTargetPost!),
    targetKey: targetKeyAsField,
    commenterAddress: commenterAddress,
    commentContentID: commentContentIDAsCS,
    allCommentsCounter: Field(pendingComment?.allCommentsCounter!),
    userCommentsCounter: Field(pendingComment?.userCommentsCounter!),
    targetCommentsCounter: Field(pendingComment?.targetCommentsCounter!),
    commentBlockHeight: Field(currentBlockHeight),
    deletionBlockHeight: Field(pendingComment?.deletionBlockHeight!),
    restorationBlockHeight: Field(pendingComment?.restorationBlockHeight!)
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
      postKey: pendingComment?.targetKey
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
    signature: pendingComment?.pendingSignature,
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

  await deleteCandidateCommentsStateHistoryStatus();

  const commentsHashedStateWitness = await updateCandidateCommentsStateHistoryStatus(
    result.transition.blockHeight,
    result.transition.latestAllCommentsCounter,
    result.transition.latestUsersCommentsCounters,
    result.transition.latestTargetsCommentsCounters,
    result.transition.latestComments
  );

  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    async () => {
      commentsContract.update(result.proof, commentsHashedStateWitness);
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

async function generateProveRepostPublicationInputs(
  pendingRepost: RepostsFindUnique,
  currentBlockHeight: bigint = pendingRepost?.pendingBlockHeight!
) {

  const reposterAddress = PublicKey.fromBase58(pendingRepost?.reposterAddress!);
  const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());
  const targetKeyAsField = Field(pendingRepost?.targetKey!);
  const signature = Signature.fromBase58(pendingRepost?.pendingSignature!);

  const repostState = new RepostState({
    isTargetPost: Bool(pendingRepost?.isTargetPost!),
    targetKey: targetKeyAsField,
    reposterAddress: reposterAddress,
    allRepostsCounter: Field(pendingRepost?.allRepostsCounter!),
    userRepostsCounter: Field(pendingRepost?.userRepostsCounter!),
    targetRepostsCounter: Field(pendingRepost?.targetRepostsCounter!),
    repostBlockHeight: Field(currentBlockHeight),
    deletionBlockHeight: Field(pendingRepost?.deletionBlockHeight!),
    restorationBlockHeight: Field(pendingRepost?.restorationBlockHeight!)
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
      postKey: pendingRepost?.targetKey
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
    signature: pendingRepost?.pendingSignature,
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

  await deleteCandidateRepostsStateHistoryStatus();

  const repostsHashedStateWitness = await updateCandidateRepostsStateHistoryStatus(
    result.transition.blockHeight,
    result.transition.latestAllRepostsCounter,
    result.transition.latestUsersRepostsCounters,
    result.transition.latestTargetsRepostsCounters,
    result.transition.latestReposts
  );
  
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    async () => {
      repostsContract.update(result.proof, repostsHashedStateWitness);
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

function generateProvePostDeletionInputs(
  pendingPostDeletion: PostsFindUnique,
  currentBlockHeight: bigint = pendingPostDeletion?.pendingBlockHeight!
) {

  const signature = Signature.fromBase58(pendingPostDeletion?.pendingSignature!);
  const posterAddress = PublicKey.fromBase58(pendingPostDeletion?.posterAddress!);
  const postCIDAsCircuitString = CircuitString.fromString(pendingPostDeletion?.postContentID!);

      const initialPostState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(pendingPostDeletion?.allPostsCounter!),
        userPostsCounter: Field(pendingPostDeletion?.userPostsCounter!),
        postBlockHeight: Field(pendingPostDeletion?.postBlockHeight!),
        deletionBlockHeight: Field(0),
        restorationBlockHeight: Field(pendingPostDeletion?.restorationBlockHeight!)
      });

      const latestPostState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(pendingPostDeletion?.allPostsCounter!),
        userPostsCounter: Field(pendingPostDeletion?.userPostsCounter!),
        postBlockHeight: Field(pendingPostDeletion?.postBlockHeight!),
        deletionBlockHeight: Field(currentBlockHeight),
        restorationBlockHeight: Field(pendingPostDeletion?.restorationBlockHeight!)
      });

      const usersPostsCounters = usersPostsCountersMap.getRoot();

      const initialPosts = postsMap.getRoot();
      const postWitness = postsMap.getWitness(Field(pendingPostDeletion?.postKey!));
      postsMap.set(Field(pendingPostDeletion?.postKey!), latestPostState.hash());
      const latestPosts = postsMap.getRoot();

      const transition = PostsTransition.createPostDeletionTransition(
        signature,
        Field(postsContext.totalNumberOfPosts),
        usersPostsCounters,
        initialPosts,
        latestPosts,
        initialPostState,
        postWitness,
        Field(currentBlockHeight)
      );

      return {
        transition: JSON.stringify(transition),
        signature: pendingPostDeletion?.pendingSignature,
        currentAllPostsCounter: postsContext.totalNumberOfPosts.toString(),
        usersPostsCounters: usersPostsCounters.toString(),
        initialPosts: initialPosts.toString(),
        latestPosts: latestPosts.toString(),
        initialPostState: JSON.stringify(initialPostState),
        postWitness: JSON.stringify(postWitness.toJSON()),
        blockHeight: currentBlockHeight.toString()
      }
}

// ============================================================================

function generateProvePostRestorationInputs(
  pendingPostRestoration: PostsFindUnique,
  currentBlockHeight: bigint = pendingPostRestoration?.pendingBlockHeight!,
) {

  const signature = Signature.fromBase58(pendingPostRestoration?.pendingSignature!);
  const posterAddress = PublicKey.fromBase58(pendingPostRestoration?.posterAddress!);
  const postCIDAsCircuitString = CircuitString.fromString(pendingPostRestoration?.postContentID!);

      const initialPostState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(pendingPostRestoration?.allPostsCounter!),
        userPostsCounter: Field(pendingPostRestoration?.userPostsCounter!),
        postBlockHeight: Field(pendingPostRestoration?.postBlockHeight!),
        deletionBlockHeight: Field(pendingPostRestoration?.deletionBlockHeight!),
        restorationBlockHeight: Field(pendingPostRestoration?.restorationBlockHeight!)
      });

      const latestPostState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(pendingPostRestoration?.allPostsCounter!),
        userPostsCounter: Field(pendingPostRestoration?.userPostsCounter!),
        postBlockHeight: Field(pendingPostRestoration?.postBlockHeight!),
        deletionBlockHeight: Field(0),
        restorationBlockHeight: Field(currentBlockHeight)
      });

      const usersPostsCounters = usersPostsCountersMap.getRoot();

      const initialPosts = postsMap.getRoot();
      const postWitness = postsMap.getWitness(Field(pendingPostRestoration?.postKey!));
      postsMap.set(Field(pendingPostRestoration?.postKey!), latestPostState.hash());
      const latestPosts = postsMap.getRoot();

      const transition = PostsTransition.createPostRestorationTransition(
        signature,
        Field(postsContext.totalNumberOfPosts),
        usersPostsCounters,
        initialPosts,
        latestPosts,
        initialPostState,
        postWitness,
        Field(currentBlockHeight)
      );

      return {
        transition: JSON.stringify(transition),
        signature: pendingPostRestoration?.pendingSignature,
        currentAllPostsCounter: postsContext.totalNumberOfPosts.toString(),
        usersPostsCounters: usersPostsCounters.toString(),
        initialPosts: initialPosts.toString(),
        latestPosts: latestPosts.toString(),
        initialPostState: JSON.stringify(initialPostState),
        postWitness: JSON.stringify(postWitness.toJSON()),
        blockHeight: currentBlockHeight.toString()
      }
}

// ============================================================================

async function generateProveCommentDeletionInputs(
  pendingCommentDeletion: CommentsFindUnique,
  currentBlockHeight: bigint = pendingCommentDeletion?.pendingBlockHeight!
) {
  const signature = Signature.fromBase58(pendingCommentDeletion?.pendingSignature!);
  const commenterAddress = PublicKey.fromBase58(pendingCommentDeletion?.commenterAddress!);
  const commentCIDAsCircuitString = CircuitString.fromString(pendingCommentDeletion?.commentContentID!);

      const initialCommentState = new CommentState({
        isTargetPost: Bool(pendingCommentDeletion?.isTargetPost!),
        targetKey: Field(pendingCommentDeletion?.targetKey!),
        commenterAddress: commenterAddress,
        commentContentID: commentCIDAsCircuitString,
        allCommentsCounter: Field(pendingCommentDeletion?.allCommentsCounter!),
        userCommentsCounter: Field(pendingCommentDeletion?.userCommentsCounter!),
        targetCommentsCounter: Field(pendingCommentDeletion?.targetCommentsCounter!),
        commentBlockHeight: Field(pendingCommentDeletion?.commentBlockHeight!),
        deletionBlockHeight: Field(0),
        restorationBlockHeight: Field(pendingCommentDeletion?.restorationBlockHeight!)
      });

      const latestCommentsState = new CommentState({
        isTargetPost: Bool(pendingCommentDeletion?.isTargetPost!),
        targetKey: Field(pendingCommentDeletion?.targetKey!),
        commenterAddress: commenterAddress,
        commentContentID: commentCIDAsCircuitString,
        allCommentsCounter: Field(pendingCommentDeletion?.allCommentsCounter!),
        userCommentsCounter: Field(pendingCommentDeletion?.userCommentsCounter!),
        targetCommentsCounter: Field(pendingCommentDeletion?.targetCommentsCounter!),
        commentBlockHeight: Field(pendingCommentDeletion?.commentBlockHeight!),
        deletionBlockHeight: Field(currentBlockHeight),
        restorationBlockHeight: Field(pendingCommentDeletion?.restorationBlockHeight!)
      });

      const usersCommentsCounters = usersCommentsCountersMap.getRoot();
      const targetsCommentsCounters = targetsCommentsCountersMap.getRoot();

      const initialComments = commentsMap.getRoot();
      const commentWitness = commentsMap.getWitness(Field(pendingCommentDeletion?.commentKey!));
      commentsMap.set(Field(pendingCommentDeletion?.commentKey!), latestCommentsState.hash());
      const latestComments = commentsMap.getRoot();

      const parent = await prisma.posts.findUnique({
        where: {
          postKey: pendingCommentDeletion?.targetKey
        }
      });

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
        Field(commentsContext.totalNumberOfComments),
        usersCommentsCounters,
        targetsCommentsCounters,
        initialComments,
        latestComments,
        initialCommentState,
        commentWitness,
        Field(currentBlockHeight)
      );
      console.log('Comment deletion transition created');

      return {
        transition: JSON.stringify(transition),
        signature: pendingCommentDeletion?.pendingSignature,
        targets: currentPosts.toString(),
        postState: JSON.stringify(parentState),
        targetWitness: JSON.stringify(parentWitness.toJSON()),
        currentAllCommentsCounter: commentsContext.totalNumberOfComments,
        usersCommentsCounters: usersCommentsCounters.toString(),
        targetsCommentsCounters: targetsCommentsCounters.toString(),
        initialComments: initialComments.toString(),
        latestComments: latestComments.toString(),
        initialCommentState: JSON.stringify(initialCommentState),
        commentWitness: JSON.stringify(commentWitness.toJSON()),
        blockHeight: currentBlockHeight.toString()
      }
}

// ============================================================================

async function generateProveCommentRestorationInputs(
  pendingCommentRestoration: CommentsFindUnique,
  currentBlockHeight: bigint = pendingCommentRestoration?.pendingBlockHeight!
) {
  const signature = Signature.fromBase58(pendingCommentRestoration?.pendingSignature!);
  const commenterAddress = PublicKey.fromBase58(pendingCommentRestoration?.commenterAddress!);
  const commentCIDAsCircuitString = CircuitString.fromString(pendingCommentRestoration?.commentContentID!);

    const initialCommentState = new CommentState({
      isTargetPost: Bool(pendingCommentRestoration?.isTargetPost!),
      targetKey: Field(pendingCommentRestoration?.targetKey!),
      commenterAddress: commenterAddress,
      commentContentID: commentCIDAsCircuitString,
      allCommentsCounter: Field(pendingCommentRestoration?.allCommentsCounter!),
      userCommentsCounter: Field(pendingCommentRestoration?.userCommentsCounter!),
      targetCommentsCounter: Field(pendingCommentRestoration?.targetCommentsCounter!),
      commentBlockHeight: Field(pendingCommentRestoration?.commentBlockHeight!),
      deletionBlockHeight: Field(pendingCommentRestoration?.deletionBlockHeight!),
      restorationBlockHeight: Field(pendingCommentRestoration?.restorationBlockHeight!)
    });

    const latestCommentsState = new CommentState({
      isTargetPost: Bool(pendingCommentRestoration?.isTargetPost!),
      targetKey: Field(pendingCommentRestoration?.targetKey!),
      commenterAddress: commenterAddress,
      commentContentID: commentCIDAsCircuitString,
      allCommentsCounter: Field(pendingCommentRestoration?.allCommentsCounter!),
      userCommentsCounter: Field(pendingCommentRestoration?.userCommentsCounter!),
      targetCommentsCounter: Field(pendingCommentRestoration?.targetCommentsCounter!),
      commentBlockHeight: Field(pendingCommentRestoration?.commentBlockHeight!),
      deletionBlockHeight: Field(0),
      restorationBlockHeight: Field(currentBlockHeight)
    });

    const usersCommentsCounters = usersCommentsCountersMap.getRoot();
    const targetsCommentsCounters = targetsCommentsCountersMap.getRoot();

    const initialComments = commentsMap.getRoot();
    const commentWitness = commentsMap.getWitness(Field(pendingCommentRestoration?.commentKey!));
    commentsMap.set(Field(pendingCommentRestoration?.commentKey!), latestCommentsState.hash());
    const latestComments = commentsMap.getRoot();

    const parent = await prisma.posts.findUnique({
      where: {
        postKey: pendingCommentRestoration?.targetKey
      }
    });

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
      Field(commentsContext.totalNumberOfComments),
      usersCommentsCounters,
      targetsCommentsCounters,
      initialComments,
      latestComments,
      initialCommentState,
      commentWitness,
      Field(currentBlockHeight)
    );
    console.log('Comment restoration transition created');

    return {
      transition: JSON.stringify(transition),
      signature: pendingCommentRestoration?.pendingSignature,
      targets: currentPosts.toString(),
      postState: JSON.stringify(parentState),
      targetWitness: JSON.stringify(parentWitness.toJSON()),
      currentAllCommentsCounter: commentsContext.totalNumberOfComments.toString(),
      usersCommentsCounters: usersCommentsCounters.toString(),
      targetsCommentsCounters: targetsCommentsCounters.toString(),
      initialComments: initialComments.toString(),
      latestComments: latestComments.toString(),
      initialCommentState: JSON.stringify(initialCommentState),
      commentWitness: JSON.stringify(commentWitness.toJSON()),
      blockHeight: currentBlockHeight.toString()
    }
}
  
// ============================================================================

async function generateProveRepostDeletionInputs(
  pendingRepostDeletion: RepostsFindUnique,
  currentBlockHeight: bigint = pendingRepostDeletion?.pendingBlockHeight!
) {

const signature = Signature.fromBase58(pendingRepostDeletion?.pendingSignature!);
const reposterAddress = PublicKey.fromBase58(pendingRepostDeletion?.reposterAddress!);

    const initialRepostState = new RepostState({
      isTargetPost: Bool(pendingRepostDeletion?.isTargetPost!),
      targetKey: Field(pendingRepostDeletion?.targetKey!),
      reposterAddress: reposterAddress,
      allRepostsCounter: Field(pendingRepostDeletion?.allRepostsCounter!),
      userRepostsCounter: Field(pendingRepostDeletion?.userRepostsCounter!),
      targetRepostsCounter: Field(pendingRepostDeletion?.targetRepostsCounter!),
      repostBlockHeight: Field(pendingRepostDeletion?.repostBlockHeight!),
      deletionBlockHeight: Field(0),
      restorationBlockHeight: Field(pendingRepostDeletion?.restorationBlockHeight!)
    });

    const latestRepostsState = new RepostState({
      isTargetPost: Bool(pendingRepostDeletion?.isTargetPost!),
      targetKey: Field(pendingRepostDeletion?.targetKey!),
      reposterAddress: reposterAddress,
      allRepostsCounter: Field(pendingRepostDeletion?.allRepostsCounter!),
      userRepostsCounter: Field(pendingRepostDeletion?.userRepostsCounter!),
      targetRepostsCounter: Field(pendingRepostDeletion?.targetRepostsCounter!),
      repostBlockHeight: Field(pendingRepostDeletion?.repostBlockHeight!),
      deletionBlockHeight: Field(currentBlockHeight),
      restorationBlockHeight: Field(pendingRepostDeletion?.restorationBlockHeight!)
    });

    const usersRepostsCounters = usersRepostsCountersMap.getRoot();
    const targetsRepostsCounters = targetsRepostsCountersMap.getRoot();

    const initialReposts = repostsMap.getRoot();
    const repostWitness = repostsMap.getWitness(Field(pendingRepostDeletion?.repostKey!));
    repostsMap.set(Field(pendingRepostDeletion?.repostKey!), latestRepostsState.hash());
    const latestReposts = repostsMap.getRoot();

    const parent = await prisma.posts.findUnique({
      where: {
        postKey: pendingRepostDeletion?.targetKey
      }
    });

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
      Field(repostsContext.totalNumberOfReposts),
      usersRepostsCounters,
      targetsRepostsCounters,
      initialReposts,
      latestReposts,
      initialRepostState,
      repostWitness,
      Field(currentBlockHeight)
    );
    console.log('Repost deletion transition created');

    return {
      transition: JSON.stringify(transition),
      signature: pendingRepostDeletion?.pendingSignature,
      targets: currentPosts.toString(),
      postState: JSON.stringify(parentState),
      targetWitness: JSON.stringify(parentWitness.toJSON()),
      currentAllRepostsCounter: repostsContext.totalNumberOfReposts.toString(),
      usersRepostsCounters: usersRepostsCounters.toString(),
      targetsRepostsCounters: targetsRepostsCounters.toString(),
      initialReposts: initialReposts.toString(),
      latestReposts: latestReposts.toString(),
      initialRepostState: JSON.stringify(initialRepostState),
      repostWitness: JSON.stringify(repostWitness.toJSON()),
      blockHeight: currentBlockHeight.toString()
    }
}

// ============================================================================

async function generateProveRepostRestorationInputs(
  pendingRepostRestoration: RepostsFindUnique,
  currentBlockHeight: bigint = pendingRepostRestoration?.pendingBlockHeight!
) {

const signature = Signature.fromBase58(pendingRepostRestoration?.pendingSignature!);
const reposterAddress = PublicKey.fromBase58(pendingRepostRestoration?.reposterAddress!);

    const initialRepostState = new RepostState({
      isTargetPost: Bool(pendingRepostRestoration?.isTargetPost!),
      targetKey: Field(pendingRepostRestoration?.targetKey!),
      reposterAddress: reposterAddress,
      allRepostsCounter: Field(pendingRepostRestoration?.allRepostsCounter!),
      userRepostsCounter: Field(pendingRepostRestoration?.userRepostsCounter!),
      targetRepostsCounter: Field(pendingRepostRestoration?.targetRepostsCounter!),
      repostBlockHeight: Field(pendingRepostRestoration?.repostBlockHeight!),
      deletionBlockHeight: Field(pendingRepostRestoration?.deletionBlockHeight!),
      restorationBlockHeight: Field(pendingRepostRestoration?.restorationBlockHeight!)
    });

    const latestRepostsState = new RepostState({
      isTargetPost: Bool(pendingRepostRestoration?.isTargetPost!),
      targetKey: Field(pendingRepostRestoration?.targetKey!),
      reposterAddress: reposterAddress,
      allRepostsCounter: Field(pendingRepostRestoration?.allRepostsCounter!),
      userRepostsCounter: Field(pendingRepostRestoration?.userRepostsCounter!),
      targetRepostsCounter: Field(pendingRepostRestoration?.targetRepostsCounter!),
      repostBlockHeight: Field(pendingRepostRestoration?.repostBlockHeight!),
      deletionBlockHeight: Field(0),
      restorationBlockHeight: Field(currentBlockHeight)
    });

    const usersRepostsCounters = usersRepostsCountersMap.getRoot();
    const targetsRepostsCounters = targetsRepostsCountersMap.getRoot();

    const initialReposts = repostsMap.getRoot();
    const repostWitness = repostsMap.getWitness(Field(pendingRepostRestoration?.repostKey!));
    repostsMap.set(Field(pendingRepostRestoration?.repostKey!), latestRepostsState.hash());
    const latestReposts = repostsMap.getRoot();

    const parent = await prisma.posts.findUnique({
      where: {
        postKey: pendingRepostRestoration?.targetKey
      }
    });

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
      Field(repostsContext.totalNumberOfReposts),
      usersRepostsCounters,
      targetsRepostsCounters,
      initialReposts,
      latestReposts,
      initialRepostState,
      repostWitness,
      Field(currentBlockHeight)
    );
    console.log('Repost restoration transition created');

    return {
      transition: JSON.stringify(transition),
      signature: pendingRepostRestoration?.pendingSignature,
      targets: currentPosts.toString(),
      postState: JSON.stringify(parentState),
      targetWitness: JSON.stringify(parentWitness.toJSON()),
      currentAllRepostsCounter: repostsContext.totalNumberOfReposts.toString(),
      usersRepostsCounters: usersRepostsCounters.toString(),
      targetsRepostsCounters: targetsRepostsCounters.toString(),
      initialReposts: initialReposts.toString(),
      latestReposts: latestReposts.toString(),
      initialRepostState: JSON.stringify(initialRepostState),
      repostWitness: JSON.stringify(repostWitness.toJSON()),
      blockHeight: currentBlockHeight.toString()
    }
}

// ============================================================================

async function generateProveReactionDeletionInputs(
  pendingReactionDeletion: ReactionsFindUnique,
  currentBlockHeight: bigint = pendingReactionDeletion?.pendingBlockHeight!
) {

const signature = Signature.fromBase58(pendingReactionDeletion?.pendingSignature!);
const reactorAddress = PublicKey.fromBase58(pendingReactionDeletion?.reactorAddress!);
const reactionCodePointAsField = Field(pendingReactionDeletion?.reactionCodePoint!);

    const initialReactionState = new ReactionState({
      isTargetPost: Bool(pendingReactionDeletion?.isTargetPost!),
      targetKey: Field(pendingReactionDeletion?.targetKey!),
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePointAsField,
      allReactionsCounter: Field(pendingReactionDeletion?.allReactionsCounter!),
      userReactionsCounter: Field(pendingReactionDeletion?.userReactionsCounter!),
      targetReactionsCounter: Field(pendingReactionDeletion?.targetReactionsCounter!),
      reactionBlockHeight: Field(pendingReactionDeletion?.reactionBlockHeight!),
      deletionBlockHeight: Field(0),
      restorationBlockHeight: Field(pendingReactionDeletion?.restorationBlockHeight!)
    });

    const latestReactionsState = new ReactionState({
      isTargetPost: Bool(pendingReactionDeletion?.isTargetPost!),
      targetKey: Field(pendingReactionDeletion?.targetKey!),
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePointAsField,
      allReactionsCounter: Field(pendingReactionDeletion?.allReactionsCounter!),
      userReactionsCounter: Field(pendingReactionDeletion?.userReactionsCounter!),
      targetReactionsCounter: Field(pendingReactionDeletion?.targetReactionsCounter!),
      reactionBlockHeight: Field(pendingReactionDeletion?.reactionBlockHeight!),
      deletionBlockHeight: Field(currentBlockHeight),
      restorationBlockHeight: Field(pendingReactionDeletion?.restorationBlockHeight!)
    });

    const usersReactionsCounters = usersReactionsCountersMap.getRoot();
    const targetsReactionsCounters = targetsReactionsCountersMap.getRoot();

    const initialReactions = reactionsMap.getRoot();
    const reactionWitness = reactionsMap.getWitness(Field(pendingReactionDeletion?.reactionKey!));
    reactionsMap.set(Field(pendingReactionDeletion?.reactionKey!), latestReactionsState.hash());
    const latestReactions = reactionsMap.getRoot();

    const parent = await prisma.posts.findUnique({
      where: {
        postKey: pendingReactionDeletion?.targetKey
      }
    });

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
      Field(reactionsContext.totalNumberOfReactions),
      usersReactionsCounters,
      targetsReactionsCounters,
      initialReactions,
      latestReactions,
      initialReactionState,
      reactionWitness,
      Field(currentBlockHeight)
    );
    console.log('Reaction deletion transition created');
    
    return {
      transition: JSON.stringify(transition),
      signature: pendingReactionDeletion?.pendingSignature,
      targets: currentPosts.toString(),
      postState: JSON.stringify(parentState),
      targetWitness: JSON.stringify(parentWitness.toJSON()),
      currentAllReactionsCounter: reactionsContext.totalNumberOfReactions.toString(),
      usersReactionsCounters: usersReactionsCounters.toString(),
      targetsReactionsCounters: targetsReactionsCounters.toString(),
      initialReactions: initialReactions.toString(),
      latestReactions: latestReactions.toString(),
      initialReactionState: JSON.stringify(initialReactionState),
      reactionWitness: JSON.stringify(reactionWitness.toJSON()),
      blockHeight: currentBlockHeight.toString()
    }
}

// ============================================================================

async function generateProveReactionRestorationInputs(
  pendingReactionRestoration: ReactionsFindUnique,
  currentBlockHeight: bigint = pendingReactionRestoration?.pendingBlockHeight!
) {

const signature = Signature.fromBase58(pendingReactionRestoration?.pendingSignature!);
const reactorAddress = PublicKey.fromBase58(pendingReactionRestoration?.reactorAddress!);
const reactionCodePointAsField = Field(pendingReactionRestoration?.reactionCodePoint!);

    const initialReactionState = new ReactionState({
      isTargetPost: Bool(pendingReactionRestoration?.isTargetPost!),
      targetKey: Field(pendingReactionRestoration?.targetKey!),
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePointAsField,
      allReactionsCounter: Field(pendingReactionRestoration?.allReactionsCounter!),
      userReactionsCounter: Field(pendingReactionRestoration?.userReactionsCounter!),
      targetReactionsCounter: Field(pendingReactionRestoration?.targetReactionsCounter!),
      reactionBlockHeight: Field(pendingReactionRestoration?.reactionBlockHeight!),
      deletionBlockHeight: Field(pendingReactionRestoration?.deletionBlockHeight!),
      restorationBlockHeight: Field(pendingReactionRestoration?.restorationBlockHeight!)
    });

    const latestReactionsState = new ReactionState({
      isTargetPost: Bool(pendingReactionRestoration?.isTargetPost!),
      targetKey: Field(pendingReactionRestoration?.targetKey!),
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePointAsField,
      allReactionsCounter: Field(pendingReactionRestoration?.allReactionsCounter!),
      userReactionsCounter: Field(pendingReactionRestoration?.userReactionsCounter!),
      targetReactionsCounter: Field(pendingReactionRestoration?.targetReactionsCounter!),
      reactionBlockHeight: Field(pendingReactionRestoration?.reactionBlockHeight!),
      deletionBlockHeight: Field(0),
      restorationBlockHeight: Field(currentBlockHeight)
    });

    const usersReactionsCounters = usersReactionsCountersMap.getRoot();
    const targetsReactionsCounters = targetsReactionsCountersMap.getRoot();

    const initialReactions = reactionsMap.getRoot();
    const reactionWitness = reactionsMap.getWitness(Field(pendingReactionRestoration?.reactionKey!));
    reactionsMap.set(Field(pendingReactionRestoration?.reactionKey!), latestReactionsState.hash());
    const latestReactions = reactionsMap.getRoot();

    const parent = await prisma.posts.findUnique({
      where: {
        postKey: pendingReactionRestoration?.targetKey
      }
    });

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
      Field(reactionsContext.totalNumberOfReactions),
      usersReactionsCounters,
      targetsReactionsCounters,
      initialReactions,
      latestReactions,
      initialReactionState,
      reactionWitness,
      Field(currentBlockHeight)
    );
    console.log('Reaction restoration transition created');

    return {
      transition: JSON.stringify(transition),
      signature: pendingReactionRestoration?.pendingSignature,
      targets: currentPosts.toString(),
      postState: JSON.stringify(parentState),
      targetWitness: JSON.stringify(parentWitness.toJSON()),
      currentAllReactionsCounter: reactionsContext.totalNumberOfReactions.toString(),
      usersReactionsCounters: usersReactionsCounters.toString(),
      targetsReactionsCounters: targetsReactionsCounters.toString(),
      initialReactions: initialReactions.toString(),
      latestReactions: latestReactions.toString(),
      initialReactionState: JSON.stringify(initialReactionState),
      reactionWitness: JSON.stringify(reactionWitness.toJSON()),
      blockHeight: currentBlockHeight.toString()
    }
}

// ============================================================================

  async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================

type TransitionsAndProofsAsStrings = {
  transition: string;
  proof: string;
}

type TransitionsAndProofs =
  | { transition: PostsTransition; proof: PostsProof }
  | { transition: ReactionsTransition; proof: ReactionsProof }
  | { transition: CommentsTransition; proof: CommentsProof }
  | { transition: RepostsTransition; proof: RepostsProof };

type PostsFindMany = Prisma.PromiseReturnType<typeof prisma.posts.findMany>;
type CommentsFindMany = Prisma.PromiseReturnType<typeof prisma.comments.findMany>;
type ReactionsFindMany = Prisma.PromiseReturnType<typeof prisma.reactions.findMany>;
type RepostsFindMany = Prisma.PromiseReturnType<typeof prisma.reposts.findMany>;
type FindMany = PostsFindMany | CommentsFindMany | ReactionsFindMany | RepostsFindMany;

type PostsFindUnique = Prisma.PromiseReturnType<typeof prisma.posts.findUnique>;
type CommentsFindUnique = Prisma.PromiseReturnType<typeof prisma.comments.findUnique>;
type ReactionsFindUnique = Prisma.PromiseReturnType<typeof prisma.reactions.findUnique>;
type RepostsFindUnique = Prisma.PromiseReturnType<typeof prisma.reposts.findUnique>;
type FindUnique = PostsFindUnique | CommentsFindUnique | ReactionsFindUnique | RepostsFindUnique;

// ============================================================================

async function assertPostsOnchainAndServerState(pendingPosts: PostsFindMany, blockHeight: bigint) {

  let isUpdated = false;
  let attempts = 0;
  while (!isUpdated && attempts < MAX_ATTEMPTS) {
    const allPostsCounterFetch = await postsContract.allPostsCounter.fetch();
    console.log('allPostsCounterFetch: ' + allPostsCounterFetch!.toString());
    const usersPostsCountersFetch = await postsContract.usersPostsCounters.fetch();
    console.log('usersPostsCountersFetch: ' + usersPostsCountersFetch!.toString());
    const postsFetch = await postsContract.posts.fetch();
    console.log('postsFetch: ' + postsFetch!.toString());
    const postsLastUpdateFetch = await postsContract.lastUpdate.fetch();
    console.log('postsLastUpdateFetch: ' + postsLastUpdateFetch!.toString());
    const postsStateHistoryFetch = await postsContract.stateHistory.fetch();
    console.log('postsStateHistory: ' + postsStateHistoryFetch!.toString());
  
    const allPostsCounterAfter = Field(postsContext.totalNumberOfPosts);
    console.log('allPostsCounterAfter: ' + allPostsCounterAfter.toString());
    const usersPostsCountersAfter = usersPostsCountersMap.getRoot();
    console.log('usersPostsCountersAfter: ' + usersPostsCountersAfter.toString());
    const postsAfter = postsMap.getRoot();
    console.log('postsAfter: ' + postsAfter.toString());
    const postsLastUpdateAfter = Field(postsContext.postsLastUpdate);
    console.log('postsLastUpdateAfter: ' + postsLastUpdateAfter.toString());
    const postsStateHistoryAfter = postsStateHistoryMap.getRoot();
    console.log('postsStateHistoryAfter: ' + postsStateHistoryAfter.toString());
  
    const allPostsCounterEqual = allPostsCounterFetch!.equals(allPostsCounterAfter).toBoolean();
    console.log('allPostsCounterEqual: ' + allPostsCounterEqual);
    const usersPostsCountersEqual = usersPostsCountersFetch!.equals(usersPostsCountersAfter).toBoolean();
    console.log('usersPostsCountersEqual: ' + usersPostsCountersEqual);
    const postsEqual = postsFetch!.equals(postsAfter).toBoolean();
    console.log('postsEqual: ' + postsEqual);
    const postsLastUpdateEqual = postsLastUpdateFetch!.equals(postsLastUpdateAfter).toBoolean();
    console.log('postsLastUpdateEqual: ' + postsLastUpdateEqual);
    const postsStateHistoryEqual = postsStateHistoryFetch!.equals(postsStateHistoryAfter).toBoolean();
    console.log('postsStateHistoryEqual: ' + postsStateHistoryEqual);
  
    isUpdated = allPostsCounterEqual
      && usersPostsCountersEqual
      && postsEqual
      && postsLastUpdateEqual
      && postsStateHistoryEqual;

    attempts += 1;
  
    if (isUpdated) {
      await prisma.$transaction(async (prismaTransaction) => {

        const lastPostsState = await getLastPostsState(prisma);

        // Change status from pending creation to loading 
        // (by the service that serves the auditable content)
        await prismaTransaction.postsStateHistory.update({
          where: {
            atBlockHeight: lastPostsState?.atBlockHeight,
            status: 'creating'
          },
          data: {
            status: 'loading'
          }
        });

        // Change status from pending action to loading
        for (const pPost of pendingPosts) {
          if (pPost.status === 'creating') {
            await prismaTransaction.posts.update({
              where: {
                postKey: pPost.postKey
              },
              data: {
                postBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          } else if (pPost.status === 'deleting') {
            await prismaTransaction.posts.update({
              where: {
                postKey: pPost.postKey
              },
              data: {
                deletionBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          } else if (pPost.status === 'restoring') {
            await prismaTransaction.posts.update({
              where: {
                postKey: pPost.postKey
              },
              data: {
                deletionBlockHeight: 0,
                restorationBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          }
        }
      });
      return;
    }
    await delay(DELAY);
  }
  throw new OnchainAndServerStateMismatchError('There is a mismatch between Posts onchain and server state');
}

// ============================================================================

async function assertCommentsOnchainAndServerState(pendingComments: CommentsFindMany, blockHeight: bigint) {

  let isUpdated = false;
  let attempts = 0;
  while (!isUpdated && attempts < MAX_ATTEMPTS) {
    const allCommentsCounterFetch = await commentsContract.allCommentsCounter.fetch();
    console.log('allCommentsCounterFetch: ' + allCommentsCounterFetch!.toString());
    const usersCommentsCountersFetch = await commentsContract.usersCommentsCounters.fetch();
    console.log('usersCommentsCountersFetch: ' + usersCommentsCountersFetch!.toString());
    const targetsCommentsCountersFetch = await commentsContract.targetsCommentsCounters.fetch();
    console.log('targetsCommentsCountersFetch: ' + targetsCommentsCountersFetch!.toString());
    const commentsFetch = await commentsContract.comments.fetch();
    console.log('commentsFetch: ' + commentsFetch!.toString());
    const commentsLastUpdateFetch = await commentsContract.lastUpdate.fetch();
    console.log('commentsLastUpdateFetch: ' + commentsLastUpdateFetch!.toString());
    const commentsStateHistoryFetch = await commentsContract.stateHistory.fetch();
    console.log('commentsStateHistoryFetch: ' + commentsStateHistoryFetch!.toString());

  
    const allCommentsCounterAfter = Field(commentsContext.totalNumberOfComments);
    console.log('allCommentsCounterAfter: ' + allCommentsCounterAfter.toString());
    const usersCommentsCountersAfter = usersCommentsCountersMap.getRoot();
    console.log('usersCommentsCountersAfter: ' + usersCommentsCountersAfter.toString());
    const targetsCommentsCountersAfter = targetsCommentsCountersMap.getRoot();
    console.log('targetsCommentsCountersAfter: ' + targetsCommentsCountersAfter.toString());
    const commentsAfter = commentsMap.getRoot();
    console.log('commentsAfter: ' + commentsAfter.toString());
    const commentsLastUpdateAfter = Field(commentsContext.commentsLastUpdate);
    console.log('commentsLastUpdateAfter: ' + commentsLastUpdateAfter.toString());
    const commentsStateHistoryAfter = commentsStateHistoryMap.getRoot();
    console.log('commentsStateHistoryAfter: ' + commentsStateHistoryAfter.toString());

  
    const allCommentsCounterEqual = allCommentsCounterFetch!.equals(allCommentsCounterAfter).toBoolean();
    console.log('allCommentsCounterEqual: ' + allCommentsCounterEqual);
    const usersCommentsCountersEqual = usersCommentsCountersFetch!.equals(usersCommentsCountersAfter).toBoolean();
    console.log('usersCommentsCountersEqual: ' + usersCommentsCountersEqual);
    const targetsCommentsCountersEqual = targetsCommentsCountersFetch!.equals(targetsCommentsCountersAfter).toBoolean();
    console.log('targetsCommentsCountersEqual: ' + targetsCommentsCountersEqual);
    const commentsEqual = commentsFetch!.equals(commentsAfter).toBoolean();
    console.log('commentsEqual: ' + commentsEqual);
    const commentsLastUpdateEqual = commentsLastUpdateFetch!.equals(commentsLastUpdateAfter).toBoolean();
    console.log('commentsLastUpdateEqual: ' + commentsLastUpdateEqual);
    const commentsStateHistoryEqual = commentsStateHistoryFetch!.equals(commentsStateHistoryAfter).toBoolean();
    console.log('commentsStateHistoryEqual: ' + commentsStateHistoryEqual);

  
    isUpdated = allCommentsCounterEqual
      && usersCommentsCountersEqual
      && targetsCommentsCountersEqual
      && commentsEqual
      && commentsLastUpdateEqual
      && commentsStateHistoryEqual;

    attempts += 1;
  
    if (isUpdated) {
      await prisma.$transaction(async (prismaTransaction) => {

        const lastCommentsState = await getLastCommentsState(prisma);

        // Change status from pending creation to loading 
        // (by the service that serves the auditable content)
        await prismaTransaction.commentsStateHistory.update({
          where: {
            atBlockHeight: lastCommentsState?.atBlockHeight,
            status: 'creating'
          },
          data: {
            status: 'loading'
          }
        });

        // Change status from pending action to loading
        for (const pComment of pendingComments) {
          if (pComment.status === 'creating') {
            await prismaTransaction.comments.update({
              where: {
                commentKey: pComment.commentKey
              },
              data: {
                commentBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          } else if (pComment.status === 'deleting') {
            await prismaTransaction.comments.update({
              where: {
                commentKey: pComment.commentKey
              },
              data: {
                deletionBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          } else if (pComment.status === 'restoring') {
            await prismaTransaction.comments.update({
              where: {
                commentKey: pComment.commentKey
              },
              data: {
                deletionBlockHeight: 0,
                restorationBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          }
        }
      });
      return;
    }
    await delay(DELAY);
  }
  throw new OnchainAndServerStateMismatchError('There is a mismatch between Comments onchain and server state');
}

// ============================================================================

async function assertReactionsOnchainAndServerState(pendingReactions: ReactionsFindMany, blockHeight: bigint) {

  let isUpdated = false;
  let attempts = 0;
  while (!isUpdated && attempts < MAX_ATTEMPTS) {
    const allReactionsCounterFetch = await reactionsContract.allReactionsCounter.fetch();
    console.log('allReactionsCounterFetch: ' + allReactionsCounterFetch!.toString());
    const usersReactionsCountersFetch = await reactionsContract.usersReactionsCounters.fetch();
    console.log('usersReactionsCountersFetch: ' + usersReactionsCountersFetch!.toString());
    const targetsReactionsCountersFetch = await reactionsContract.targetsReactionsCounters.fetch();
    console.log('targetsReactionsCountersFetch: ' + targetsReactionsCountersFetch!.toString());
    const reactionsFetch = await reactionsContract.reactions.fetch();
    console.log('reactionsFetch: ' + reactionsFetch!.toString());
    const reactionsLastUpdateFetch = await reactionsContract.lastUpdate.fetch();
    console.log('reactionsLastUpdateFetch: ' + reactionsLastUpdateFetch!.toString());
    const reactionsStateHistoryFetch = await reactionsContract.stateHistory.fetch();
    console.log('reactionsStateHistoryFetch: ' + reactionsStateHistoryFetch!.toString());

  
    const allReactionsCounterAfter = Field(reactionsContext.totalNumberOfReactions);
    console.log('allReactionsCounterAfter: ' + allReactionsCounterAfter.toString());
    const usersReactionsCountersAfter = usersReactionsCountersMap.getRoot();
    console.log('usersReactionsCountersAfter: ' + usersReactionsCountersAfter.toString());
    const targetsReactionsCountersAfter = targetsReactionsCountersMap.getRoot();
    console.log('targetsReactionsCountersAfter: ' + targetsReactionsCountersAfter.toString());
    const reactionsAfter = reactionsMap.getRoot();
    console.log('reactionsAfter: ' + reactionsAfter.toString());
    const reactionsLastUpdateAfter = Field(reactionsContext.reactionsLastUpdate);
    console.log('reactionsLastUpdateAfter: ' + reactionsLastUpdateAfter.toString());
    const reactionsStateHistoryAfter = reactionsStateHistoryMap.getRoot();
    console.log('reactionsStateHistoryAfter: ' + reactionsStateHistoryAfter.toString());

  
    const allReactionsCounterEqual = allReactionsCounterFetch!.equals(allReactionsCounterAfter).toBoolean();
    console.log('allReactionsCounterEqual: ' + allReactionsCounterEqual);
    const usersReactionsCountersEqual = usersReactionsCountersFetch!.equals(usersReactionsCountersAfter).toBoolean();
    console.log('usersReactionsCountersEqual: ' + usersReactionsCountersEqual);
    const targetsReactionsCountersEqual = targetsReactionsCountersFetch!.equals(targetsReactionsCountersAfter).toBoolean();
    console.log('targetsReactionsCountersEqual: ' + targetsReactionsCountersEqual);
    const reactionsEqual = reactionsFetch!.equals(reactionsAfter).toBoolean();
    console.log('reactionsEqual: ' + reactionsEqual);
    const reactionsLastUpdateEqual = reactionsLastUpdateFetch!.equals(reactionsLastUpdateAfter).toBoolean();
    console.log('reactionsLastUpdateEqual: ' + reactionsLastUpdateEqual);
    const reactionsStateHistoryEqual = reactionsStateHistoryFetch!.equals(reactionsStateHistoryAfter).toBoolean();
    console.log('reactionsStateHistoryEqual: ' + reactionsStateHistoryEqual);

  
    isUpdated = allReactionsCounterEqual
      && usersReactionsCountersEqual
      && targetsReactionsCountersEqual
      && reactionsEqual
      && reactionsLastUpdateEqual
      && reactionsStateHistoryEqual;

    attempts += 1;
  
    if (isUpdated) {
      await prisma.$transaction(async (prismaTransaction) => {

        const lastReactionsState = await getLastReactionsState(prisma);

        // Change status from pending creation to loading 
        // (by the service that serves the auditable content)
        await prismaTransaction.reactionsStateHistory.update({
          where: {
            atBlockHeight: lastReactionsState?.atBlockHeight,
            status: 'creating'
          },
          data: {
            status: 'loading'
          }
        });

        // Change status from pending action to loading
        for (const pReaction of pendingReactions) {
          if (pReaction.status === 'creating') {
            await prismaTransaction.reactions.update({
              where: {
                reactionKey: pReaction.reactionKey
              },
              data: {
                reactionBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          } else if (pReaction.status === 'deleting') {
            await prismaTransaction.reactions.update({
              where: {
                reactionKey: pReaction.reactionKey
              },
              data: {
                deletionBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          } else if (pReaction.status === 'restoring') {
            await prismaTransaction.reactions.update({
              where: {
                reactionKey: pReaction.reactionKey
              },
              data: {
                deletionBlockHeight: 0,
                restorationBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          }
        }
      });
      return;
    }
    await delay(DELAY);
  }
  throw new OnchainAndServerStateMismatchError('There is a mismatch between Reactions onchain and server state');
}

// ============================================================================

async function assertRepostsOnchainAndServerState(pendingReposts: RepostsFindMany, blockHeight: bigint) {

  let isUpdated = false;
  let attempts = 0;
  while (!isUpdated && attempts < MAX_ATTEMPTS) {
    const allRepostsCounterFetch = await repostsContract.allRepostsCounter.fetch();
    console.log('allRepostsCounterFetch: ' + allRepostsCounterFetch!.toString());
    const usersRepostsCountersFetch = await repostsContract.usersRepostsCounters.fetch();
    console.log('usersRepostsCountersFetch: ' + usersRepostsCountersFetch!.toString());
    const targetsRepostsCountersFetch = await repostsContract.targetsRepostsCounters.fetch();
    console.log('targetsRepostsCountersFetch: ' + targetsRepostsCountersFetch!.toString());
    const repostsFetch = await repostsContract.reposts.fetch();
    console.log('repostsFetch: ' + repostsFetch!.toString());
    const repostsLastUpdateFetch = await repostsContract.lastUpdate.fetch();
    console.log('repostsLastUpdateFetch: ' + repostsLastUpdateFetch!.toString());
    const repostsStateHistoryFetch = await repostsContract.stateHistory.fetch();
    console.log('repostsStateHistoryFetch: ' + repostsStateHistoryFetch!.toString());
  
    const allRepostsCounterAfter = Field(repostsContext.totalNumberOfReposts);
    console.log('allRepostsCounterAfter: ' + allRepostsCounterAfter.toString());
    const usersRepostsCountersAfter = usersRepostsCountersMap.getRoot();
    console.log('usersRepostsCountersAfter: ' + usersRepostsCountersAfter.toString());
    const targetsRepostsCountersAfter = targetsRepostsCountersMap.getRoot();
    console.log('targetsRepostsCountersAfter: ' + targetsRepostsCountersAfter.toString());
    const repostsAfter = repostsMap.getRoot();
    console.log('repostsAfter: ' + repostsAfter.toString());
    const repostsLastUpdateAfter = Field(repostsContext.repostsLastUpdate);
    console.log('repostsLastUpdateAfter: ' + repostsLastUpdateAfter.toString());
    const repostsStateHistoryAfter = repostsStateHistoryMap.getRoot();
    console.log('repostsStateHistoryAfter: ' + repostsStateHistoryAfter.toString());
  
    const allRepostsCounterEqual = allRepostsCounterFetch!.equals(allRepostsCounterAfter).toBoolean();
    console.log('allRepostsCounterEqual: ' + allRepostsCounterEqual);
    const usersRepostsCountersEqual = usersRepostsCountersFetch!.equals(usersRepostsCountersAfter).toBoolean();
    console.log('usersRepostsCountersEqual: ' + usersRepostsCountersEqual);
    const targetsRepostsCountersEqual = targetsRepostsCountersFetch!.equals(targetsRepostsCountersAfter).toBoolean();
    console.log('targetsRepostsCountersEqual: ' + targetsRepostsCountersEqual);
    const repostsEqual = repostsFetch!.equals(repostsAfter).toBoolean();
    console.log('repostsEqual: ' + repostsEqual);
    const repostsLastUpdateEqual = repostsLastUpdateFetch!.equals(repostsLastUpdateAfter).toBoolean();
    console.log('repostsLastUpdateEqual: ' + repostsLastUpdateEqual);
    const repostsStateHistoryEqual = repostsStateHistoryFetch!.equals(repostsStateHistoryAfter).toBoolean();
    console.log('repostsStateHistoryEqual: ' + repostsStateHistoryEqual);
  
    isUpdated = allRepostsCounterEqual
      && usersRepostsCountersEqual
      && targetsRepostsCountersEqual
      && repostsEqual
      && repostsLastUpdateEqual
      && repostsStateHistoryEqual;

    attempts += 1;
  
    if (isUpdated) {
      await prisma.$transaction(async (prismaTransaction) => {

        const lastRepostsState = await getLastRepostsState(prisma);

        // Change status from pending creation to loading 
        // (by the service that serves the auditable content)
        await prismaTransaction.repostsStateHistory.update({
          where: {
            atBlockHeight: lastRepostsState?.atBlockHeight,
            status: 'creating'
          },
          data: {
            status: 'loading'
          }
        });

        // Change status from pending action to loading
        for (const pRepost of pendingReposts) {
          if (pRepost.status === 'creating') {
            await prismaTransaction.reposts.update({
              where: {
                repostKey: pRepost.repostKey
              },
              data: {
                repostBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          } else if (pRepost.status === 'deleting') {
            await prismaTransaction.reposts.update({
              where: {
                repostKey: pRepost.repostKey
              },
              data: {
                deletionBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          } else if (pRepost.status === 'restoring') {
            await prismaTransaction.reposts.update({
              where: {
                repostKey: pRepost.repostKey
              },
              data: {
                deletionBlockHeight: 0,
                restorationBlockHeight: blockHeight,
                status: 'loading',
                pendingBlockHeight: null,
                pendingSignature: null,
                pendingTransaction: null
              }
            });
          }
        }
      });
      return;
    }
    await delay(DELAY);
  }
  throw new OnchainAndServerStateMismatchError('There is a mismatch between Reposts onchain and server state');
}

// ============================================================================

async function resetServerPostPublicationsState(pendingPosts: PostsFindMany) {
  console.log('Current number of posts: ' + postsContext.totalNumberOfPosts);
  postsContext.totalNumberOfPosts -= pendingPosts.length;
  console.log('Restored number of posts: ' + postsContext.totalNumberOfPosts);

  const pendingPosters = new Set(pendingPosts.map( post => post.posterAddress));
  for (const poster of pendingPosters) {
    const userPosts = await prisma.posts.findMany({
      where: {
        posterAddress: poster,
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

  await deleteCandidatePostsStateHistoryStatus();
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
      where: {
        targetKey: target,
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

  await deleteCandidateCommentsStateHistoryStatus();
}

// ============================================================================

async function resetServerReactionPublicationsState(pendingReactions: ReactionsFindMany) {
  console.log('Current number of reactions: ' + reactionsContext.totalNumberOfReactions);
  reactionsContext.totalNumberOfReactions -= pendingReactions.length;
  console.log('Restored number of reactions: ' + reactionsContext.totalNumberOfReactions);

  const pendingReactioners = new Set(pendingReactions.map( reaction => reaction.reactorAddress));
  for (const reactioner of pendingReactioners) {
    const userReactions = await prisma.reactions.findMany({
      where: {
        reactorAddress: reactioner,
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

  await deleteCandidateReactionsStateHistoryStatus();
}

// ============================================================================

async function resetServerRepostPublicationsState(pendingReposts: RepostsFindMany) {
  console.log('Current number of reposts: ' + repostsContext.totalNumberOfReposts);
  repostsContext.totalNumberOfReposts -= pendingReposts.length;
  console.log('Restored number of reposts: ' + repostsContext.totalNumberOfReposts);

  const pendingReposters = new Set(pendingReposts.map( repost => repost.reposterAddress));
  for (const reposter of pendingReposters) {
    const userReposts = await prisma.reposts.findMany({
      where: {
        reposterAddress: reposter,
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


  await deleteCandidateRepostsStateHistoryStatus();
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

async function updateCandidatePostsStateHistoryStatus(
  blockHeight: Field,
  allPostsCounter: Field,
  usersPostsCounters: Field,
  posts: Field
) {

  const lastHashedState = Poseidon.hash([
    allPostsCounter,
    usersPostsCounters,
    posts,
  ]);

  const postsHashedStateWitness = postsStateHistoryMap.getWitness(blockHeight);

  // Update in-memory state for postsContext
  postsContext.postsLastUpdate = Number(blockHeight);
  postsStateHistoryMap.set(blockHeight, lastHashedState);

  // Persist candidate postsStateHistory entry for the current transaction
  await createSQLPostsState(
    allPostsCounter,
    usersPostsCounters,
    posts,
    lastHashedState,
    blockHeight
  );

  return postsHashedStateWitness;
}

// ============================================================================

async function updateCandidateReactionsStateHistoryStatus(
  blockHeight: Field,
  allReactionsCounter: Field,
  usersReactionsCounters: Field,
  targetsReactionsCounters: Field,
  reactions: Field
) {

  const lastHashedState = Poseidon.hash([
    allReactionsCounter,
    usersReactionsCounters,
    targetsReactionsCounters,
    reactions
  ]);

  const reactionsHashedStateWitness = reactionsStateHistoryMap.getWitness(blockHeight);

  // Update in-memory state for reactionsContext
  reactionsContext.reactionsLastUpdate = Number(blockHeight);
  reactionsStateHistoryMap.set(blockHeight, lastHashedState);

  // Persist candidate reactionsStateHistory entry for the current transaction
  await createSQLReactionsState(
    allReactionsCounter,
    usersReactionsCounters,
    targetsReactionsCounters,
    reactions,
    lastHashedState,
    blockHeight
  );

  return reactionsHashedStateWitness;
}

// ============================================================================

async function updateCandidateCommentsStateHistoryStatus(
  blockHeight: Field,
  allCommentsCounter: Field,
  usersCommentsCounters: Field,
  targetsCommentsCounters: Field,
  comments: Field
) {

  const lastHashedState = Poseidon.hash([
    allCommentsCounter,
    usersCommentsCounters,
    targetsCommentsCounters,
    comments
  ]);

  const commentsHashedStateWitness = commentsStateHistoryMap.getWitness(blockHeight);

  // Update in-memory state for commentsContext
  commentsContext.commentsLastUpdate = Number(blockHeight);
  commentsStateHistoryMap.set(blockHeight, lastHashedState);

  // Persist candidate commentsStateHistory entry for the current transaction
  await createSQLCommentsState(
    allCommentsCounter,
    usersCommentsCounters,
    targetsCommentsCounters,
    comments,
    lastHashedState,
    blockHeight
  );

  return commentsHashedStateWitness;
}

// ============================================================================

async function updateCandidateRepostsStateHistoryStatus(
  blockHeight: Field,
  allRepostsCounter: Field,
  usersRepostsCounters: Field,
  targetsRepostsCounters: Field,
  reposts: Field
) {

  const lastHashedState = Poseidon.hash([
    allRepostsCounter,
    usersRepostsCounters,
    targetsRepostsCounters,
    reposts
  ]);

  const repostsHashedStateWitness = repostsStateHistoryMap.getWitness(blockHeight);

  // Update in-memory state for repostsContext
  repostsContext.repostsLastUpdate = Number(blockHeight);
  repostsStateHistoryMap.set(blockHeight, lastHashedState);

  // Persist candidate repostsStateHistory entry for the current transaction
  await createSQLRepostsState(
    allRepostsCounter,
    usersRepostsCounters,
    targetsRepostsCounters,
    reposts,
    lastHashedState,
    blockHeight
  );

  return repostsHashedStateWitness;
}

// ============================================================================

async function deleteCandidatePostsStateHistoryStatus() {
  const lastPostsState = await getLastPostsState(prisma);

  // Delete last candidate postsStateHistory entry for failed transaction
  if (lastPostsState !== null && lastPostsState.status == 'creating') {
    await prisma.postsStateHistory.delete({
      where: {
        atBlockHeight: lastPostsState.atBlockHeight,
        status: 'creating'
      }
    });
  }
}

// ============================================================================

async function deleteCandidateReactionsStateHistoryStatus() {
  const lastReactionsState = await getLastReactionsState(prisma);

  // Delete last candidate reactionsStateHistory entry for failed transaction
  if (lastReactionsState !== null && lastReactionsState.status == 'creating') {
    await prisma.reactionsStateHistory.delete({
      where: {
        atBlockHeight: lastReactionsState.atBlockHeight,
        status: 'creating'
      }
    });
  }
}

// ============================================================================

async function deleteCandidateCommentsStateHistoryStatus() {
  const lastCommentsState = await getLastCommentsState(prisma);

  // Delete last candidate commentsStateHistory entry for failed transaction
  if (lastCommentsState !== null && lastCommentsState.status == 'creating') {
    await prisma.commentsStateHistory.delete({
      where: {
        atBlockHeight: lastCommentsState.atBlockHeight,
        status: 'creating'
      }
    });
  }
}

// ============================================================================

async function deleteCandidateRepostsStateHistoryStatus() {
  const lastRepostsState = await getLastRepostsState(prisma);

  // Delete last candidate repostsStateHistory entry for failed transaction
  if (lastRepostsState !== null && lastRepostsState.status == 'creating') {
    await prisma.repostsStateHistory.delete({
      where: {
        atBlockHeight: lastRepostsState.atBlockHeight,
        status: 'creating'
      }
    });
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

type CheckZkappTransactionAwaited = Awaited<ReturnType<typeof checkZkappTransaction>>;

// ============================================================================

async function waitForZkAppTransaction(transactionHash: string | null) {
  let previousTransactionState: CheckZkappTransactionAwaited = {
    success: false,
    failureReason: null
  }
  if (transactionHash === null) {
    return 'missing'
  }

  while (previousTransactionState.success === false
    && previousTransactionState.failureReason === null
  ) {
    previousTransactionState = await checkZkappTransaction(transactionHash, BLOCKCHAIN_LENGTH);
    await delay(DELAY);
  }

  if (previousTransactionState.success === true) {
    return 'confirmed';
  } else if (previousTransactionState.failureReason !== null) {
    console.log(previousTransactionState.failureReason.flat(2).join("\n"));
    return 'rejected';
  }
}

// ============================================================================

async function getPendingActions(model: any, allActionsCounter: string, status: string) {
  return await model.findMany({
      take: PARALLEL_NUMBER,
      orderBy: {
          [allActionsCounter]: 'asc'
      },
      where: {
          status: status
      }
  });
}

type ActionKey = 'postKey' | 'reactionKey' | 'commentKey' | 'repostKey';

function getProperActionKey(pendingAction: FindUnique) {
  const possibleKeys: readonly ActionKey[] = ['postKey', 'reactionKey', 'commentKey', 'repostKey'];
  let actionKey: ActionKey | undefined;
  
  for (const key of possibleKeys) {
    if (key in pendingAction!) {
      actionKey = key;
      break;
    }
  }

  if (!actionKey) {
    throw new Error("No valid key found in pendingActions.");
  }

  return actionKey;
}

async function updateTransactionHash(
  model: any,
  pendingActions: FindMany,
  pendingTransactionHash: string,
) {
  const actionKey = getProperActionKey(pendingActions[0]);
  for (const pendingAction of pendingActions) {
    await model.update({
      where: {
        [actionKey]: pendingAction[actionKey as keyof typeof pendingAction]
      },
      data: {
        pendingTransaction: pendingTransactionHash
      }
    });
  }
}

async function updateActionStatus(
  model: any,
  pendingAction: FindUnique,
  currentBlockHeight: bigint,
  status: status_enum,
) {
  const actionKey = getProperActionKey(pendingAction);
  pendingAction!.status = status;
  await model.update({
    where: {
      [actionKey]: pendingAction![actionKey as keyof typeof pendingAction]
    },
    data: {
      status: status,
      pendingBlockHeight: currentBlockHeight
    }
  });
}

type ContextKey = 'totalNumberOfPosts' | 'totalNumberOfReactions' | 'totalNumberOfComments' | 'totalNumberOfReposts';

function getProperContextKey(context: any) {
  const possibleKeys: readonly ContextKey[] = ['totalNumberOfPosts', 'totalNumberOfReactions', 'totalNumberOfComments', 'totalNumberOfReposts'];
  let contextKey: typeof possibleKeys[number] | undefined;
  
  for (const key of possibleKeys) {
    if (key in context) {
      contextKey = key;
      break;
    }
  }

  if (!contextKey) {
    throw new Error("No valid key found in context.");
  }

  return contextKey;
}

async function handlePendingTransaction(
  pendingActions: FindMany,
  context: any,
  generateInputsForProving: Function,
  assertState: Function,
  actionStatus: status_enum
) {

  console.log('Syncing onchain and server state...');
  const previousTransactionStatus = await waitForZkAppTransaction(pendingActions[0].pendingTransaction);

  // Check if the transaction was successfully confirmed
  if (previousTransactionStatus === 'confirmed') {

    // Update in-memory state
    const contextKey = getProperContextKey(context);
    if (actionStatus === 'creating') {
      context[contextKey] += pendingActions.length;
    }
    for (const action of pendingActions) {
      await generateInputsForProving(action);
    }

    // Update database if onchain state matches updated server state
    await assertState(pendingActions, pendingActions[0].pendingBlockHeight!);
    return true;
  }
  return false;
}

async function toTransitionsAndProofs(
  transitionAndProof: TransitionsAndProofsAsStrings
) {
  const parsedTransition = JSON.parse(transitionAndProof.transition);
  const parsedProof = JSON.parse(transitionAndProof.proof);

  if (parsedTransition.initialPosts !== undefined) {
    return {
      transition: PostsTransition.fromJSON(parsedTransition),
      proof: await PostsProof.fromJSON(parsedProof),
    };
  } else if (parsedTransition.initialReactions !== undefined) {
    return {
      transition: ReactionsTransition.fromJSON(parsedTransition),
      proof: await ReactionsProof.fromJSON(parsedProof),
    };
  } else if (parsedTransition.initialComments !== undefined) {
    return {
      transition: CommentsTransition.fromJSON(parsedTransition),
      proof: await CommentsProof.fromJSON(parsedProof),
    };
  } else if (parsedTransition.initialReposts !== undefined) {
    return {
      transition: RepostsTransition.fromJSON(parsedTransition),
      proof: await RepostsProof.fromJSON(parsedProof),
    };
  }

  throw new Error('Unknown transition type');
}

async function confirmTransaction(pendingTransaction: Mina.PendingTransaction) {
  startTime = performance.now();
  console.log('Confirming transaction...');
  let status = 'pending';
  while (status === 'pending') {
    status = await getTransactionStatus(pendingTransaction);
  }
  endTime = performance.now();
  console.log(`Waited ${(endTime - startTime)/1000/60} minutes for transaction confirmation or rejection`);
  return status;
}

async function processPendingActions(
  context: any,
  pendingActions: FindMany,
  generateInputsForProving: Function,
  queue: any, queueEvents: any,
  updateOnChainState: Function,
  model: any,
  assertState: Function,
  resetState: Function,
  actionStatus: status_enum
) {
  const contextKey = getProperContextKey(context);
  if (actionStatus === 'creating') {
    context[contextKey] += pendingActions.length;
  }

  const lastBlock = await fetchLastBlock(configPosts.url);
  const currentBlockHeight = lastBlock.blockchainLength.toBigint();
  const inputsForProving: any[] = [];
  console.log('Processing pending actions at blockheight: ' + currentBlockHeight);

  for (const action of pendingActions) {
    const result = await generateInputsForProving(action, currentBlockHeight);
    inputsForProving.push(result);
    await updateActionStatus(model, action, currentBlockHeight, actionStatus);
  }

  const jobsPromises: Promise<any>[] = [];
  for (const inputs of inputsForProving) {
    const job = await queue.add(
      `job`,
      { inputs: inputs }
    );
    jobsPromises.push(job.waitUntilFinished(queueEvents));
  }

  const transitionsAndProofsAsStrings: TransitionsAndProofsAsStrings[] = await Promise.all(jobsPromises);
  const transitionsAndProofs: TransitionsAndProofs[] = [];
  for (const transitionAndProof of transitionsAndProofsAsStrings) {
    transitionsAndProofs.push(await toTransitionsAndProofs(transitionAndProof));
  }

  const pendingTransaction = await updateOnChainState(transitionsAndProofs);
  await updateTransactionHash(model, pendingActions, pendingTransaction.hash);

  const transactionStatus = await confirmTransaction(pendingTransaction);

  if (transactionStatus === 'rejected') {
    await resetState(pendingActions);
    return false;
  }

  await assertState(pendingActions, currentBlockHeight);
  return true;
}

// ============================================================================

async function createSQLPostsState (
  allPostsCounter: Field,
  usersPostsCounters: Field,
  posts: Field,
  hashedState: Field,
  postsLastUpdate: Field
) {
  await prisma.postsStateHistory.create({
    data: {
      allPostsCounter: allPostsCounter.toBigInt(),
      userPostsCounter: usersPostsCounters.toString(),
      posts: posts.toString(),
      hashedState: hashedState.toString(),
      atBlockHeight: postsLastUpdate.toBigInt(),
      status: 'creating'
    }
  });
}

// ============================================================================

async function createSQLReactionsState (
  allReactionsCounter: Field,
  usersReactionsCounters: Field,
  targetsReactionsCounters: Field,
  reactions: Field,
  hashedState: Field,
  reactionsLastUpdate: Field
) {
  await prisma.reactionsStateHistory.create({
    data: {
      allReactionsCounter: allReactionsCounter.toBigInt(),
      usersReactionsCounters: usersReactionsCounters.toString(),
      targetsReactionsCounters: targetsReactionsCounters.toString(),
      reactions: reactions.toString(),
      hashedState: hashedState.toString(),
      atBlockHeight: reactionsLastUpdate.toBigInt(),
      status: 'creating'
    }
  });
}

// ============================================================================

async function createSQLCommentsState (
  allCommentsCounter: Field,
  usersCommentsCounters: Field,
  targetsCommentsCounters: Field,
  comments: Field,
  hashedState: Field,
  commentsLastUpdate: Field
) {
  await prisma.commentsStateHistory.create({
    data: {
      allCommentsCounter: allCommentsCounter.toBigInt(),
      usersCommentsCounters: usersCommentsCounters.toString(),
      targetsCommentsCounters: targetsCommentsCounters.toString(),
      comments: comments.toString(),
      hashedState: hashedState.toString(),
      atBlockHeight: commentsLastUpdate.toBigInt(),
      status: 'creating'
    }
  });
}

// ============================================================================

async function createSQLRepostsState (
  allRepostsCounter: Field,
  usersRepostsCounters: Field,
  targetsRepostsCounters: Field,
  reposts: Field,
  hashedState: Field,
  repostsLastUpdate: Field
) {
  await prisma.repostsStateHistory.create({
    data: {
      allRepostsCounter: allRepostsCounter.toBigInt(),
      usersRepostsCounters: usersRepostsCounters.toString(),
      targetsRepostsCounters: targetsRepostsCounters.toString(),
      reposts: reposts.toString(),
      hashedState: hashedState.toString(),
      atBlockHeight: repostsLastUpdate.toBigInt(),
      status: 'creating'
    }
  });
}

// ============================================================================