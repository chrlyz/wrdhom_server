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

  const transition = PostsTransition.fromJSON(JSON.parse(job.data.provePostDeletionInputs.transition));
  const signature = Signature.fromBase58(job.data.provePostDeletionInputs.signature);
  const currentAllPostsCounter = Field(job.data.provePostDeletionInputs.currentAllPostsCounter);
  const usersPostsCounters = Field(job.data.provePostDeletionInputs.usersPostsCounters);
  const initialPostState = PostState.fromJSON(JSON.parse(job.data.provePostDeletionInputs.initialPostState)) as PostState;
  const initialPosts = Field(job.data.provePostDeletionInputs.initialPosts);
  const latestPosts = Field(job.data.provePostDeletionInputs.latestPosts);
  const postWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.provePostDeletionInputs.postWitness));
  const deletionBlockHeight = Field(job.data.provePostDeletionInputs.blockHeight);
  
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

  const transition = PostsTransition.fromJSON(JSON.parse(job.data.provePostRestorationInputs.transition));
  const signature = Signature.fromBase58(job.data.provePostRestorationInputs.signature);
  const currentAllPostsCounter = Field(job.data.provePostRestorationInputs.currentAllPostsCounter);
  const usersPostsCounters = Field(job.data.provePostRestorationInputs.usersPostsCounters);
  const initialPostState = PostState.fromJSON(JSON.parse(job.data.provePostRestorationInputs.initialPostState)) as PostState;
  const initialPosts = Field(job.data.provePostRestorationInputs.initialPosts);
  const latestPosts = Field(job.data.provePostRestorationInputs.latestPosts);
  const postWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.provePostRestorationInputs.postWitness));
  const restorationBlockHeight = Field(job.data.provePostRestorationInputs.blockHeight);
  
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

new Worker('reactionRestorationsQueue', async job => {

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

new Worker('commentsQueue', async job => {

  const transition = CommentsTransition.fromJSON(JSON.parse(job.data.proveCommentInputs.transition));
  const signature = Signature.fromBase58(job.data.proveCommentInputs.signature);
  const targets = Field(job.data.proveCommentInputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveCommentInputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentInputs.targetWitness));
  const commentState = CommentState.fromJSON(JSON.parse(job.data.proveCommentInputs.commentState)) as CommentState;
  const initialUsersCommentsCounters = Field(job.data.proveCommentInputs.initialUsersCommentsCounters);
  const latestUsersCommentsCounters = Field(job.data.proveCommentInputs.latestUsersCommentsCounters);
  const userCommentsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentInputs.userCommentsCounterWitness));
  const initialTargetsCommentsCounters = Field(job.data.proveCommentInputs.initialTargetsCommentsCounters);
  const latestTargetsCommentsCounters = Field(job.data.proveCommentInputs.latestTargetsCommentsCounters);
  const targetCommentsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentInputs.targetCommentsCounterWitness));
  const initialComments = Field(job.data.proveCommentInputs.initialComments);
  const latestComments = Field(job.data.proveCommentInputs.latestComments);
  const commentWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentInputs.commentWitness));

  
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

  const transition = CommentsTransition.fromJSON(JSON.parse(job.data.proveCommentDeletionInputs.transition));
  const signature = Signature.fromBase58(job.data.proveCommentDeletionInputs.signature);
  const targets = Field(job.data.proveCommentDeletionInputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveCommentDeletionInputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentDeletionInputs.targetWitness));
  const currentAllCommentsCounter = Field(job.data.proveCommentDeletionInputs.currentAllCommentsCounter);
  const initialCommentState = CommentState.fromJSON(JSON.parse(job.data.proveCommentDeletionInputs.initialCommentState)) as CommentState;
  const usersCommentsCounters = Field(job.data.proveCommentDeletionInputs.usersCommentsCounters);
  const targetsCommentsCounters = Field(job.data.proveCommentDeletionInputs.targetsCommentsCounters);
  const initialComments = Field(job.data.proveCommentDeletionInputs.initialComments);
  const latestComments = Field(job.data.proveCommentDeletionInputs.latestComments);
  const commentWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentDeletionInputs.commentWitness));
  const deletionBlockHeight = Field(job.data.proveCommentDeletionInputs.blockHeight);
  
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

  const transition = CommentsTransition.fromJSON(JSON.parse(job.data.proveCommentRestorationInputs.transition));
  const signature = Signature.fromBase58(job.data.proveCommentRestorationInputs.signature);
  const targets = Field(job.data.proveCommentRestorationInputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveCommentRestorationInputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentRestorationInputs.targetWitness));
  const currentAllCommentsCounter = Field(job.data.proveCommentRestorationInputs.currentAllCommentsCounter);
  const initialCommentState = CommentState.fromJSON(JSON.parse(job.data.proveCommentRestorationInputs.initialCommentState)) as CommentState;
  const usersCommentsCounters = Field(job.data.proveCommentRestorationInputs.usersCommentsCounters);
  const targetsCommentsCounters = Field(job.data.proveCommentRestorationInputs.targetsCommentsCounters);
  const initialComments = Field(job.data.proveCommentRestorationInputs.initialComments);
  const latestComments = Field(job.data.proveCommentRestorationInputs.latestComments);
  const commentWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentRestorationInputs.commentWitness));
  const restorationBlockHeight = Field(job.data.proveCommentRestorationInputs.blockHeight);
  
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

  const transition = RepostsTransition.fromJSON(JSON.parse(job.data.proveRepostDeletionInput.transition));
  const signature = Signature.fromBase58(job.data.proveRepostDeletionInput.signature);
  const targets = Field(job.data.proveRepostDeletionInput.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveRepostDeletionInput.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostDeletionInput.targetWitness));
  const currentAllRepostsCounter = Field(job.data.proveRepostDeletionInput.currentAllRepostsCounter);
  const initialRepostState = RepostState.fromJSON(JSON.parse(job.data.proveRepostDeletionInput.initialRepostState)) as RepostState;
  const usersRepostsCounters = Field(job.data.proveRepostDeletionInput.usersRepostsCounters);
  const targetsRepostsCounters = Field(job.data.proveRepostDeletionInput.targetsRepostsCounters);
  const initialReposts = Field(job.data.proveRepostDeletionInput.initialReposts);
  const latestReposts = Field(job.data.proveRepostDeletionInput.latestReposts);
  const repostWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostDeletionInput.repostWitness));
  const deletionBlockHeight = Field(job.data.proveRepostDeletionInput.deletionBlockHeight);
  
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

  const transition = RepostsTransition.fromJSON(JSON.parse(job.data.proveRepostRestorationInput.transition));
  const signature = Signature.fromBase58(job.data.proveRepostRestorationInput.signature);
  const targets = Field(job.data.proveRepostRestorationInput.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveRepostRestorationInput.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostRestorationInput.targetWitness));
  const currentAllRepostsCounter = Field(job.data.proveRepostRestorationInput.currentAllRepostsCounter);
  const initialRepostState = RepostState.fromJSON(JSON.parse(job.data.proveRepostRestorationInput.initialRepostState)) as RepostState;
  const usersRepostsCounters = Field(job.data.proveRepostRestorationInput.usersRepostsCounters);
  const targetsRepostsCounters = Field(job.data.proveRepostRestorationInput.targetsRepostsCounters);
  const initialReposts = Field(job.data.proveRepostRestorationInput.initialReposts);
  const latestReposts = Field(job.data.proveRepostRestorationInput.latestReposts);
  const repostWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostRestorationInput.repostWitness));
  const restorationBlockHeight = Field(job.data.proveRepostRestorationInput.restorationBlockHeight);
  
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