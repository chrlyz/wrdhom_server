import { Signature, Field, MerkleMapWitness } from 'o1js';
import { PostState, PostsTransition, Posts, PostsProof,
  Reactions, ReactionState, ReactionsTransition, ReactionsProof,
Comments, CommentState, CommentsTransition, CommentsProof,
Reposts, RepostState, RepostsTransition, RepostsProof } from 'wrdhom';
import { Worker } from 'bullmq';
import * as dotenv from 'dotenv';

// Load .env
dotenv.config();

const connection = {
    host: process.env.HOST,
    port: Number(process.env.PORT)
}

const startTime = performance.now();
console.log('Compiling Posts ZkProgram...');
await Posts.compile();
console.log('Compiling Reactions ZkProgram...');
await Reactions.compile();
console.log('Compiling Comments ZkProgram...');
await Comments.compile();
console.log('Compiling Reposts ZkProgram...');
await Reposts.compile();
console.log('Compiled');
const endTime = performance.now();
console.log(`${(endTime - startTime)/1000/60} minutes`);

// ============================================================================

const worker = new Worker('queue', async job => {

    const transition = PostsTransition.fromJSON(JSON.parse(job.data.provePostInput.transition));
    const signature = Signature.fromBase58(job.data.provePostInput.signature);
    const postState = PostState.fromJSON(JSON.parse(job.data.provePostInput.postState)) as PostState;
    const initialUsersPostsCounters = Field(job.data.provePostInput.initialUsersPostsCounters);
    const latestUsersPostsCounters = Field(job.data.provePostInput.latestUsersPostsCounters);
    const initialPosts = Field(job.data.provePostInput.initialPosts);
    const latestPosts = Field(job.data.provePostInput.latestPosts);
    const postWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.provePostInput.postWitness));
    const userPostsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.provePostInput.userPostsCounterWitness));
    
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

    return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

  }, { connection: connection, lockDuration: 600000 });

// ============================================================================

  const mergingWorker = new Worker('mergingQueue', async job => {

    const mergedTransition = PostsTransition.fromJSON(JSON.parse(job.data.mergedTransition));
    const proof1 = PostsProof.fromJSON(JSON.parse(job.data.proof1));
    const proof2 = PostsProof.fromJSON(JSON.parse(job.data.proof2));

    const proof = await Posts.proveMergedPostsTransitions(mergedTransition, proof1, proof2);
    console.log('Merged proof created');
    return {transition: JSON.stringify(mergedTransition), proof: JSON.stringify(proof.toJSON()) }

  }, { connection: connection, lockDuration: 600000 });

// ============================================================================

const postDeletionsWorker = new Worker('postDeletionsQueue', async job => {

  const transition = PostsTransition.fromJSON(JSON.parse(job.data.provePostDeletionInput.transition));
  const signature = Signature.fromBase58(job.data.provePostDeletionInput.signature);
  const currentAllPostsCounter = Field(job.data.provePostDeletionInput.currentAllPostsCounter);
  const usersPostsCounters = Field(job.data.provePostDeletionInput.usersPostsCounters);
  const initialPostState = PostState.fromJSON(JSON.parse(job.data.provePostDeletionInput.initialPostState)) as PostState;
  const initialPosts = Field(job.data.provePostDeletionInput.initialPosts);
  const latestPosts = Field(job.data.provePostDeletionInput.latestPosts);
  const postWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.provePostDeletionInput.postWitness));
  const deletionBlockHeight = Field(job.data.provePostDeletionInput.deletionBlockHeight);
  
  const proof = await Posts.provePostDeletionTransition(
    transition,
    signature,
    currentAllPostsCounter,
    usersPostsCounters,
    initialPosts,
    latestPosts,
    initialPostState,
    postWitness,
    deletionBlockHeight
  );
  console.log('Proof created');

  return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

const postRestorationsWorker = new Worker('postRestorationsQueue', async job => {

  const transition = PostsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const currentAllPostsCounter = Field(job.data.inputs.currentAllPostsCounter);
  const usersPostsCounters = Field(job.data.inputs.usersPostsCounters);
  const initialPostState = PostState.fromJSON(JSON.parse(job.data.inputs.initialPostState)) as PostState;
  const initialPosts = Field(job.data.inputs.initialPosts);
  const latestPosts = Field(job.data.inputs.latestPosts);
  const postWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.postWitness));
  const restorationBlockHeight = Field(job.data.inputs.restorationBlockHeight);
  
  const proof = await Posts.provePostRestorationTransition(
    transition,
    signature,
    currentAllPostsCounter,
    usersPostsCounters,
    initialPosts,
    latestPosts,
    initialPostState,
    postWitness,
    restorationBlockHeight
  );
  console.log('Proof created');

  return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

const reactionsWorker = new Worker('reactionsQueue', async job => {

  const transition = ReactionsTransition.fromJSON(JSON.parse(job.data.proveReactionInput.transition));
  const signature = Signature.fromBase58(job.data.proveReactionInput.signature);
  const targets = Field(job.data.proveReactionInput.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveReactionInput.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionInput.targetWitness));
  const reactionState = ReactionState.fromJSON(JSON.parse(job.data.proveReactionInput.reactionState)) as ReactionState;
  const initialUsersReactionsCounters = Field(job.data.proveReactionInput.initialUsersReactionsCounters);
  const latestUsersReactionsCounters = Field(job.data.proveReactionInput.latestUsersReactionsCounters);
  const userReactionsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionInput.userReactionsCounterWitness));
  const initialTargetsReactionsCounters = Field(job.data.proveReactionInput.initialTargetsReactionsCounters);
  const latestTargetsReactionsCounters = Field(job.data.proveReactionInput.latestTargetsReactionsCounters);
  const targetReactionsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionInput.targetReactionsCounterWitness));
  const initialReactions = Field(job.data.proveReactionInput.initialReactions);
  const latestReactions = Field(job.data.proveReactionInput.latestReactions);
  const reactionWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionInput.reactionWitness));
  
  const proof = await Reactions.proveReactionPublishingTransition(
    transition,
    signature,
    targets,
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

  return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

const mergingReactionsWorker = new Worker('mergingReactionsQueue', async job => {

  const mergedTransition = ReactionsTransition.fromJSON(JSON.parse(job.data.mergedTransition));
  const proof1 = ReactionsProof.fromJSON(JSON.parse(job.data.proof1));
  const proof2 = ReactionsProof.fromJSON(JSON.parse(job.data.proof2));

  const proof = await Reactions.proveMergedReactionsTransitions(mergedTransition, proof1, proof2);
  console.log('Merged proof created');
  return {transition: JSON.stringify(mergedTransition), proof: JSON.stringify(proof.toJSON()) }

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

const reactionDeletionsWorker = new Worker('reactionDeletionsQueue', async job => {

  const transition = ReactionsTransition.fromJSON(JSON.parse(job.data.proveReactionDeletionInput.transition));
  const signature = Signature.fromBase58(job.data.proveReactionDeletionInput.signature);
  const targets = Field(job.data.proveReactionDeletionInput.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveReactionDeletionInput.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionDeletionInput.targetWitness));
  const currentAllReactionsCounter = Field(job.data.proveReactionDeletionInput.currentAllReactionsCounter);
  const initialReactionState = ReactionState.fromJSON(JSON.parse(job.data.proveReactionDeletionInput.initialReactionState)) as ReactionState;
  const usersReactionsCounters = Field(job.data.proveReactionDeletionInput.usersReactionsCounters);
  const targetsReactionsCounters = Field(job.data.proveReactionDeletionInput.targetsReactionsCounters);
  const initialReactions = Field(job.data.proveReactionDeletionInput.initialReactions);
  const latestReactions = Field(job.data.proveReactionDeletionInput.latestReactions);
  const reactionWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionDeletionInput.reactionWitness));
  const deletionBlockHeight = Field(job.data.proveReactionDeletionInput.deletionBlockHeight);
  
  const proof = await Reactions.proveReactionDeletionTransition(
    transition,
    signature,
    targets,
    postState,
    targetWitness,
    currentAllReactionsCounter,
    usersReactionsCounters,
    targetsReactionsCounters,
    initialReactions,
    latestReactions,
    initialReactionState,
    reactionWitness,
    deletionBlockHeight
  );
  console.log('Proof created');

  return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

const reactionRestorationsWorker = new Worker('reactionRestorationsQueue', async job => {

  const transition = ReactionsTransition.fromJSON(JSON.parse(job.data.proveReactionRestorationInput.transition));
  const signature = Signature.fromBase58(job.data.proveReactionRestorationInput.signature);
  const targets = Field(job.data.proveReactionRestorationInput.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveReactionRestorationInput.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionRestorationInput.targetWitness));
  const currentAllReactionsCounter = Field(job.data.proveReactionRestorationInput.currentAllReactionsCounter);
  const initialReactionState = ReactionState.fromJSON(JSON.parse(job.data.proveReactionRestorationInput.initialReactionState)) as ReactionState;
  const usersReactionsCounters = Field(job.data.proveReactionRestorationInput.usersReactionsCounters);
  const targetsReactionsCounters = Field(job.data.proveReactionRestorationInput.targetsReactionsCounters);
  const initialReactions = Field(job.data.proveReactionRestorationInput.initialReactions);
  const latestReactions = Field(job.data.proveReactionRestorationInput.latestReactions);
  const reactionWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionRestorationInput.reactionWitness));
  const restorationBlockHeight = Field(job.data.proveReactionRestorationInput.restorationBlockHeight);
  
  const proof = await Reactions.proveReactionRestorationTransition(
    transition,
    signature,
    targets,
    postState,
    targetWitness,
    currentAllReactionsCounter,
    usersReactionsCounters,
    targetsReactionsCounters,
    initialReactions,
    latestReactions,
    initialReactionState,
    reactionWitness,
    restorationBlockHeight
  );
  console.log('Proof created');

  return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

const commentsQueueWorker = new Worker('commentsQueue', async job => {

  const transition = CommentsTransition.fromJSON(JSON.parse(job.data.proveCommentInput.transition));
  const signature = Signature.fromBase58(job.data.proveCommentInput.signature);
  const targets = Field(job.data.proveCommentInput.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveCommentInput.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentInput.targetWitness));
  const commentState = CommentState.fromJSON(JSON.parse(job.data.proveCommentInput.commentState)) as CommentState;
  const initialUsersCommentsCounters = Field(job.data.proveCommentInput.initialUsersCommentsCounters);
  const latestUsersCommentsCounters = Field(job.data.proveCommentInput.latestUsersCommentsCounters);
  const userCommentsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentInput.userCommentsCounterWitness));
  const initialTargetsCommentsCounters = Field(job.data.proveCommentInput.initialTargetsCommentsCounters);
  const latestTargetsCommentsCounters = Field(job.data.proveCommentInput.latestTargetsCommentsCounters);
  const targetCommentsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentInput.targetCommentsCounterWitness));
  const initialComments = Field(job.data.proveCommentInput.initialComments);
  const latestComments = Field(job.data.proveCommentInput.latestComments);
  const commentWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentInput.commentWitness));

  
  const proof = await Comments.proveCommentPublishingTransition(
    transition,
    signature,
    targets,
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
  console.log('Proof created');

  return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

const mergingCommentsWorker = new Worker('mergingCommentsQueue', async job => {

  const mergedTransition = CommentsTransition.fromJSON(JSON.parse(job.data.mergedTransition));
  const proof1 = CommentsProof.fromJSON(JSON.parse(job.data.proof1));
  const proof2 = CommentsProof.fromJSON(JSON.parse(job.data.proof2));

  const proof = await Comments.proveMergedCommentsTransitions(mergedTransition, proof1, proof2);
  console.log('Merged proof created');
  return {transition: JSON.stringify(mergedTransition), proof: JSON.stringify(proof.toJSON()) }

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

const commentDeletionsWorker = new Worker('commentDeletionsQueue', async job => {

  const transition = CommentsTransition.fromJSON(JSON.parse(job.data.proveCommentDeletionInput.transition));
  const signature = Signature.fromBase58(job.data.proveCommentDeletionInput.signature);
  const targets = Field(job.data.proveCommentDeletionInput.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveCommentDeletionInput.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentDeletionInput.targetWitness));
  const currentAllCommentsCounter = Field(job.data.proveCommentDeletionInput.currentAllCommentsCounter);
  const initialCommentState = CommentState.fromJSON(JSON.parse(job.data.proveCommentDeletionInput.initialCommentState)) as CommentState;
  const usersCommentsCounters = Field(job.data.proveCommentDeletionInput.usersCommentsCounters);
  const targetsCommentsCounters = Field(job.data.proveCommentDeletionInput.targetsCommentsCounters);
  const initialComments = Field(job.data.proveCommentDeletionInput.initialComments);
  const latestComments = Field(job.data.proveCommentDeletionInput.latestComments);
  const commentWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentDeletionInput.commentWitness));
  const deletionBlockHeight = Field(job.data.proveCommentDeletionInput.deletionBlockHeight);
  
  const proof = await Comments.proveCommentDeletionTransition(
    transition,
    signature,
    targets,
    postState,
    targetWitness,
    currentAllCommentsCounter,
    usersCommentsCounters,
    targetsCommentsCounters,
    initialComments,
    latestComments,
    initialCommentState,
    commentWitness,
    deletionBlockHeight
  );
  console.log('Proof created');

  return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

const commentRestorationsWorker = new Worker('commentRestorationsQueue', async job => {

  const transition = CommentsTransition.fromJSON(JSON.parse(job.data.proveCommentRestorationInput.transition));
  const signature = Signature.fromBase58(job.data.proveCommentRestorationInput.signature);
  const targets = Field(job.data.proveCommentRestorationInput.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveCommentRestorationInput.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentRestorationInput.targetWitness));
  const currentAllCommentsCounter = Field(job.data.proveCommentRestorationInput.currentAllCommentsCounter);
  const initialCommentState = CommentState.fromJSON(JSON.parse(job.data.proveCommentRestorationInput.initialCommentState)) as CommentState;
  const usersCommentsCounters = Field(job.data.proveCommentRestorationInput.usersCommentsCounters);
  const targetsCommentsCounters = Field(job.data.proveCommentRestorationInput.targetsCommentsCounters);
  const initialComments = Field(job.data.proveCommentRestorationInput.initialComments);
  const latestComments = Field(job.data.proveCommentRestorationInput.latestComments);
  const commentWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentRestorationInput.commentWitness));
  const restorationBlockHeight = Field(job.data.proveCommentRestorationInput.restorationBlockHeight);
  
  const proof = await Comments.proveCommentRestorationTransition(
    transition,
    signature,
    targets,
    postState,
    targetWitness,
    currentAllCommentsCounter,
    usersCommentsCounters,
    targetsCommentsCounters,
    initialComments,
    latestComments,
    initialCommentState,
    commentWitness,
    restorationBlockHeight
  );
  console.log('Proof created');

  return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

const repostsQueueWorker = new Worker('repostsQueue', async job => {

  const transition = RepostsTransition.fromJSON(JSON.parse(job.data.proveRepostInput.transition));
  const signature = Signature.fromBase58(job.data.proveRepostInput.signature);
  const targets = Field(job.data.proveRepostInput.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveRepostInput.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostInput.targetWitness));
  const repostState = RepostState.fromJSON(JSON.parse(job.data.proveRepostInput.repostState)) as RepostState;
  const initialUsersRepostsCounters = Field(job.data.proveRepostInput.initialUsersRepostsCounters);
  const latestUsersRepostsCounters = Field(job.data.proveRepostInput.latestUsersRepostsCounters);
  const userRepostsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostInput.userRepostsCounterWitness));
  const initialTargetsRepostsCounters = Field(job.data.proveRepostInput.initialTargetsRepostsCounters);
  const latestTargetsRepostsCounters = Field(job.data.proveRepostInput.latestTargetsRepostsCounters);
  const targetRepostsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostInput.targetRepostsCounterWitness));
  const initialReposts = Field(job.data.proveRepostInput.initialReposts);
  const latestReposts = Field(job.data.proveRepostInput.latestReposts);
  const repostWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostInput.repostWitness));

  
  const proof = await Reposts.proveRepostPublishingTransition(
    transition,
    signature,
    targets,
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

  return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

const mergingRepostsWorker = new Worker('mergingRepostsQueue', async job => {

  const mergedTransition = RepostsTransition.fromJSON(JSON.parse(job.data.mergedTransition));
  const proof1 = RepostsProof.fromJSON(JSON.parse(job.data.proof1));
  const proof2 = RepostsProof.fromJSON(JSON.parse(job.data.proof2));

  const proof = await Reposts.proveMergedRepostsTransitions(mergedTransition, proof1, proof2);
  console.log('Merged proof created');
  return {transition: JSON.stringify(mergedTransition), proof: JSON.stringify(proof.toJSON()) }

}, { connection: connection, lockDuration: 600000 });

// ============================================================================