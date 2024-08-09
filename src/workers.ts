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

new Worker('postsQueue', async job => {

    const transition = PostsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
    const signature = Signature.fromBase58(job.data.inputs.signature);
    const postState = PostState.fromJSON(JSON.parse(job.data.inputs.postState)) as PostState;
    const initialUsersPostsCounters = Field(job.data.inputs.initialUsersPostsCounters);
    const latestUsersPostsCounters = Field(job.data.inputs.latestUsersPostsCounters);
    const initialPosts = Field(job.data.inputs.initialPosts);
    const latestPosts = Field(job.data.inputs.latestPosts);
    const postWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.postWitness));
    const userPostsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.userPostsCounterWitness));
    
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

new Worker('mergingPostsQueue', async job => {

    const mergedTransition = PostsTransition.fromJSON(JSON.parse(job.data.mergedTransition));
    const proof1 = await PostsProof.fromJSON(JSON.parse(job.data.proof1));
    const proof2 = await PostsProof.fromJSON(JSON.parse(job.data.proof2));

    const proof = await Posts.proveMergedPostsTransitions(mergedTransition, proof1, proof2);
    console.log('Merged proof created');
    return {transition: JSON.stringify(mergedTransition), proof: JSON.stringify(proof.toJSON()) }

  }, { connection: connection, lockDuration: 600000 });

// ============================================================================

new Worker('postDeletionsQueue', async job => {

  const transition = PostsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const currentAllPostsCounter = Field(job.data.inputs.currentAllPostsCounter);
  const usersPostsCounters = Field(job.data.inputs.usersPostsCounters);
  const initialPostState = PostState.fromJSON(JSON.parse(job.data.inputs.initialPostState)) as PostState;
  const initialPosts = Field(job.data.inputs.initialPosts);
  const latestPosts = Field(job.data.inputs.latestPosts);
  const postWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.postWitness));
  const deletionBlockHeight = Field(job.data.inputs.blockHeight);
  
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

new Worker('postRestorationsQueue', async job => {

  const transition = PostsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const currentAllPostsCounter = Field(job.data.inputs.currentAllPostsCounter);
  const usersPostsCounters = Field(job.data.inputs.usersPostsCounters);
  const initialPostState = PostState.fromJSON(JSON.parse(job.data.inputs.initialPostState)) as PostState;
  const initialPosts = Field(job.data.inputs.initialPosts);
  const latestPosts = Field(job.data.inputs.latestPosts);
  const postWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.postWitness));
  const restorationBlockHeight = Field(job.data.inputs.blockHeight);
  
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

new Worker('reactionsQueue', async job => {

  const transition = ReactionsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const targets = Field(job.data.inputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.inputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetWitness));
  const reactionState = ReactionState.fromJSON(JSON.parse(job.data.inputs.reactionState)) as ReactionState;
  const initialUsersReactionsCounters = Field(job.data.inputs.initialUsersReactionsCounters);
  const latestUsersReactionsCounters = Field(job.data.inputs.latestUsersReactionsCounters);
  const userReactionsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.userReactionsCounterWitness));
  const initialTargetsReactionsCounters = Field(job.data.inputs.initialTargetsReactionsCounters);
  const latestTargetsReactionsCounters = Field(job.data.inputs.latestTargetsReactionsCounters);
  const targetReactionsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetReactionsCounterWitness));
  const initialReactions = Field(job.data.inputs.initialReactions);
  const latestReactions = Field(job.data.inputs.latestReactions);
  const reactionWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.reactionWitness));
  
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

new Worker('mergingReactionsQueue', async job => {

  const mergedTransition = ReactionsTransition.fromJSON(JSON.parse(job.data.mergedTransition));
  const proof1 = await ReactionsProof.fromJSON(JSON.parse(job.data.proof1));
  const proof2 = await ReactionsProof.fromJSON(JSON.parse(job.data.proof2));

  const proof = await Reactions.proveMergedReactionsTransitions(mergedTransition, proof1, proof2);
  console.log('Merged proof created');
  return {transition: JSON.stringify(mergedTransition), proof: JSON.stringify(proof.toJSON()) }

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

new Worker('reactionDeletionsQueue', async job => {

  const transition = ReactionsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const targets = Field(job.data.inputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.inputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetWitness));
  const currentAllReactionsCounter = Field(job.data.inputs.currentAllReactionsCounter);
  const initialReactionState = ReactionState.fromJSON(JSON.parse(job.data.inputs.initialReactionState)) as ReactionState;
  const usersReactionsCounters = Field(job.data.inputs.usersReactionsCounters);
  const targetsReactionsCounters = Field(job.data.inputs.targetsReactionsCounters);
  const initialReactions = Field(job.data.inputs.initialReactions);
  const latestReactions = Field(job.data.inputs.latestReactions);
  const reactionWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.reactionWitness));
  const deletionBlockHeight = Field(job.data.inputs.blockHeight);
  
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

new Worker('reactionRestorationsQueue', async job => {

  const transition = ReactionsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const targets = Field(job.data.inputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.inputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetWitness));
  const currentAllReactionsCounter = Field(job.data.inputs.currentAllReactionsCounter);
  const initialReactionState = ReactionState.fromJSON(JSON.parse(job.data.inputs.initialReactionState)) as ReactionState;
  const usersReactionsCounters = Field(job.data.inputs.usersReactionsCounters);
  const targetsReactionsCounters = Field(job.data.inputs.targetsReactionsCounters);
  const initialReactions = Field(job.data.inputs.initialReactions);
  const latestReactions = Field(job.data.inputs.latestReactions);
  const reactionWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.reactionWitness));
  const restorationBlockHeight = Field(job.data.inputs.blockHeight);
  
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

new Worker('commentsQueue', async job => {

  const transition = CommentsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const targets = Field(job.data.inputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.inputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetWitness));
  const commentState = CommentState.fromJSON(JSON.parse(job.data.inputs.commentState)) as CommentState;
  const initialUsersCommentsCounters = Field(job.data.inputs.initialUsersCommentsCounters);
  const latestUsersCommentsCounters = Field(job.data.inputs.latestUsersCommentsCounters);
  const userCommentsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.userCommentsCounterWitness));
  const initialTargetsCommentsCounters = Field(job.data.inputs.initialTargetsCommentsCounters);
  const latestTargetsCommentsCounters = Field(job.data.inputs.latestTargetsCommentsCounters);
  const targetCommentsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetCommentsCounterWitness));
  const initialComments = Field(job.data.inputs.initialComments);
  const latestComments = Field(job.data.inputs.latestComments);
  const commentWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.commentWitness));

  
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

new Worker('mergingCommentsQueue', async job => {

  const mergedTransition = CommentsTransition.fromJSON(JSON.parse(job.data.mergedTransition));
  const proof1 = await CommentsProof.fromJSON(JSON.parse(job.data.proof1));
  const proof2 = await CommentsProof.fromJSON(JSON.parse(job.data.proof2));

  const proof = await Comments.proveMergedCommentsTransitions(mergedTransition, proof1, proof2);
  console.log('Merged proof created');
  return {transition: JSON.stringify(mergedTransition), proof: JSON.stringify(proof.toJSON()) }

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

new Worker('commentDeletionsQueue', async job => {

  const transition = CommentsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const targets = Field(job.data.inputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.inputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetWitness));
  const currentAllCommentsCounter = Field(job.data.inputs.currentAllCommentsCounter);
  const initialCommentState = CommentState.fromJSON(JSON.parse(job.data.inputs.initialCommentState)) as CommentState;
  const usersCommentsCounters = Field(job.data.inputs.usersCommentsCounters);
  const targetsCommentsCounters = Field(job.data.inputs.targetsCommentsCounters);
  const initialComments = Field(job.data.inputs.initialComments);
  const latestComments = Field(job.data.inputs.latestComments);
  const commentWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.commentWitness));
  const deletionBlockHeight = Field(job.data.inputs.blockHeight);
  
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

new Worker('commentRestorationsQueue', async job => {

  const transition = CommentsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const targets = Field(job.data.inputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.inputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetWitness));
  const currentAllCommentsCounter = Field(job.data.inputs.currentAllCommentsCounter);
  const initialCommentState = CommentState.fromJSON(JSON.parse(job.data.inputs.initialCommentState)) as CommentState;
  const usersCommentsCounters = Field(job.data.inputs.usersCommentsCounters);
  const targetsCommentsCounters = Field(job.data.inputs.targetsCommentsCounters);
  const initialComments = Field(job.data.inputs.initialComments);
  const latestComments = Field(job.data.inputs.latestComments);
  const commentWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.commentWitness));
  const restorationBlockHeight = Field(job.data.inputs.blockHeight);
  
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

new Worker('repostsQueue', async job => {

  const transition = RepostsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const targets = Field(job.data.inputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.inputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetWitness));
  const repostState = RepostState.fromJSON(JSON.parse(job.data.inputs.repostState)) as RepostState;
  const initialUsersRepostsCounters = Field(job.data.inputs.initialUsersRepostsCounters);
  const latestUsersRepostsCounters = Field(job.data.inputs.latestUsersRepostsCounters);
  const userRepostsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.userRepostsCounterWitness));
  const initialTargetsRepostsCounters = Field(job.data.inputs.initialTargetsRepostsCounters);
  const latestTargetsRepostsCounters = Field(job.data.inputs.latestTargetsRepostsCounters);
  const targetRepostsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetRepostsCounterWitness));
  const initialReposts = Field(job.data.inputs.initialReposts);
  const latestReposts = Field(job.data.inputs.latestReposts);
  const repostWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.repostWitness));

  
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

new Worker('mergingRepostsQueue', async job => {

  const mergedTransition = RepostsTransition.fromJSON(JSON.parse(job.data.mergedTransition));
  const proof1 = await RepostsProof.fromJSON(JSON.parse(job.data.proof1));
  const proof2 = await RepostsProof.fromJSON(JSON.parse(job.data.proof2));

  const proof = await Reposts.proveMergedRepostsTransitions(mergedTransition, proof1, proof2);
  console.log('Merged proof created');
  return {transition: JSON.stringify(mergedTransition), proof: JSON.stringify(proof.toJSON()) }

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

new Worker('repostDeletionsQueue', async job => {

  const transition = RepostsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const targets = Field(job.data.inputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.inputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetWitness));
  const currentAllRepostsCounter = Field(job.data.inputs.currentAllRepostsCounter);
  const initialRepostState = RepostState.fromJSON(JSON.parse(job.data.inputs.initialRepostState)) as RepostState;
  const usersRepostsCounters = Field(job.data.inputs.usersRepostsCounters);
  const targetsRepostsCounters = Field(job.data.inputs.targetsRepostsCounters);
  const initialReposts = Field(job.data.inputs.initialReposts);
  const latestReposts = Field(job.data.inputs.latestReposts);
  const repostWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.repostWitness));
  const deletionBlockHeight = Field(job.data.inputs.blockHeight);
  
  const proof = await Reposts.proveRepostDeletionTransition(
    transition,
    signature,
    targets,
    postState,
    targetWitness,
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

  return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

new Worker('repostRestorationsQueue', async job => {

  const transition = RepostsTransition.fromJSON(JSON.parse(job.data.inputs.transition));
  const signature = Signature.fromBase58(job.data.inputs.signature);
  const targets = Field(job.data.inputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.inputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.targetWitness));
  const currentAllRepostsCounter = Field(job.data.inputs.currentAllRepostsCounter);
  const initialRepostState = RepostState.fromJSON(JSON.parse(job.data.inputs.initialRepostState)) as RepostState;
  const usersRepostsCounters = Field(job.data.inputs.usersRepostsCounters);
  const targetsRepostsCounters = Field(job.data.inputs.targetsRepostsCounters);
  const initialReposts = Field(job.data.inputs.initialReposts);
  const latestReposts = Field(job.data.inputs.latestReposts);
  const repostWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.inputs.repostWitness));
  const restorationBlockHeight = Field(job.data.inputs.blockHeight);
  
  const proof = await Reposts.proveRepostRestorationTransition(
    transition,
    signature,
    targets,
    postState,
    targetWitness,
    currentAllRepostsCounter,
    usersRepostsCounters,
    targetsRepostsCounters,
    initialReposts,
    latestReposts,
    initialRepostState,
    repostWitness,
    restorationBlockHeight
  );
  console.log('Proof created');

  return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};

}, { connection: connection, lockDuration: 600000 });