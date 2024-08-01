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

    const transition = PostsTransition.fromJSON(JSON.parse(job.data.provePostPublicationInputs.transition));
    const signature = Signature.fromBase58(job.data.provePostPublicationInputs.signature);
    const postState = PostState.fromJSON(JSON.parse(job.data.provePostPublicationInputs.postState)) as PostState;
    const initialUsersPostsCounters = Field(job.data.provePostPublicationInputs.initialUsersPostsCounters);
    const latestUsersPostsCounters = Field(job.data.provePostPublicationInputs.latestUsersPostsCounters);
    const initialPosts = Field(job.data.provePostPublicationInputs.initialPosts);
    const latestPosts = Field(job.data.provePostPublicationInputs.latestPosts);
    const postWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.provePostPublicationInputs.postWitness));
    const userPostsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.provePostPublicationInputs.userPostsCounterWitness));
    
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

  const transition = ReactionsTransition.fromJSON(JSON.parse(job.data.proveReactionPublicationInputs.transition));
  const signature = Signature.fromBase58(job.data.proveReactionPublicationInputs.signature);
  const targets = Field(job.data.proveReactionPublicationInputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveReactionPublicationInputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionPublicationInputs.targetWitness));
  const reactionState = ReactionState.fromJSON(JSON.parse(job.data.proveReactionPublicationInputs.reactionState)) as ReactionState;
  const initialUsersReactionsCounters = Field(job.data.proveReactionPublicationInputs.initialUsersReactionsCounters);
  const latestUsersReactionsCounters = Field(job.data.proveReactionPublicationInputs.latestUsersReactionsCounters);
  const userReactionsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionPublicationInputs.userReactionsCounterWitness));
  const initialTargetsReactionsCounters = Field(job.data.proveReactionPublicationInputs.initialTargetsReactionsCounters);
  const latestTargetsReactionsCounters = Field(job.data.proveReactionPublicationInputs.latestTargetsReactionsCounters);
  const targetReactionsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionPublicationInputs.targetReactionsCounterWitness));
  const initialReactions = Field(job.data.proveReactionPublicationInputs.initialReactions);
  const latestReactions = Field(job.data.proveReactionPublicationInputs.latestReactions);
  const reactionWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionPublicationInputs.reactionWitness));
  
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

  const transition = ReactionsTransition.fromJSON(JSON.parse(job.data.proveReactionDeletionInputs.transition));
  const signature = Signature.fromBase58(job.data.proveReactionDeletionInputs.signature);
  const targets = Field(job.data.proveReactionDeletionInputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveReactionDeletionInputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionDeletionInputs.targetWitness));
  const currentAllReactionsCounter = Field(job.data.proveReactionDeletionInputs.currentAllReactionsCounter);
  const initialReactionState = ReactionState.fromJSON(JSON.parse(job.data.proveReactionDeletionInputs.initialReactionState)) as ReactionState;
  const usersReactionsCounters = Field(job.data.proveReactionDeletionInputs.usersReactionsCounters);
  const targetsReactionsCounters = Field(job.data.proveReactionDeletionInputs.targetsReactionsCounters);
  const initialReactions = Field(job.data.proveReactionDeletionInputs.initialReactions);
  const latestReactions = Field(job.data.proveReactionDeletionInputs.latestReactions);
  const reactionWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionDeletionInputs.reactionWitness));
  const deletionBlockHeight = Field(job.data.proveReactionDeletionInputs.blockHeight);
  
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

  const transition = ReactionsTransition.fromJSON(JSON.parse(job.data.proveReactionRestorationInputs.transition));
  const signature = Signature.fromBase58(job.data.proveReactionRestorationInputs.signature);
  const targets = Field(job.data.proveReactionRestorationInputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveReactionRestorationInputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionRestorationInputs.targetWitness));
  const currentAllReactionsCounter = Field(job.data.proveReactionRestorationInputs.currentAllReactionsCounter);
  const initialReactionState = ReactionState.fromJSON(JSON.parse(job.data.proveReactionRestorationInputs.initialReactionState)) as ReactionState;
  const usersReactionsCounters = Field(job.data.proveReactionRestorationInputs.usersReactionsCounters);
  const targetsReactionsCounters = Field(job.data.proveReactionRestorationInputs.targetsReactionsCounters);
  const initialReactions = Field(job.data.proveReactionRestorationInputs.initialReactions);
  const latestReactions = Field(job.data.proveReactionRestorationInputs.latestReactions);
  const reactionWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveReactionRestorationInputs.reactionWitness));
  const restorationBlockHeight = Field(job.data.proveReactionRestorationInputs.blockHeight);
  
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

  const transition = CommentsTransition.fromJSON(JSON.parse(job.data.proveCommentPublicationInputs.transition));
  const signature = Signature.fromBase58(job.data.proveCommentPublicationInputs.signature);
  const targets = Field(job.data.proveCommentPublicationInputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveCommentPublicationInputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentPublicationInputs.targetWitness));
  const commentState = CommentState.fromJSON(JSON.parse(job.data.proveCommentPublicationInputs.commentState)) as CommentState;
  const initialUsersCommentsCounters = Field(job.data.proveCommentPublicationInputs.initialUsersCommentsCounters);
  const latestUsersCommentsCounters = Field(job.data.proveCommentPublicationInputs.latestUsersCommentsCounters);
  const userCommentsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentPublicationInputs.userCommentsCounterWitness));
  const initialTargetsCommentsCounters = Field(job.data.proveCommentPublicationInputs.initialTargetsCommentsCounters);
  const latestTargetsCommentsCounters = Field(job.data.proveCommentPublicationInputs.latestTargetsCommentsCounters);
  const targetCommentsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentPublicationInputs.targetCommentsCounterWitness));
  const initialComments = Field(job.data.proveCommentPublicationInputs.initialComments);
  const latestComments = Field(job.data.proveCommentPublicationInputs.latestComments);
  const commentWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveCommentPublicationInputs.commentWitness));

  
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

  const transition = RepostsTransition.fromJSON(JSON.parse(job.data.proveRepostPublicationInputs.transition));
  const signature = Signature.fromBase58(job.data.proveRepostPublicationInputs.signature);
  const targets = Field(job.data.proveRepostPublicationInputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveRepostPublicationInputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostPublicationInputs.targetWitness));
  const repostState = RepostState.fromJSON(JSON.parse(job.data.proveRepostPublicationInputs.repostState)) as RepostState;
  const initialUsersRepostsCounters = Field(job.data.proveRepostPublicationInputs.initialUsersRepostsCounters);
  const latestUsersRepostsCounters = Field(job.data.proveRepostPublicationInputs.latestUsersRepostsCounters);
  const userRepostsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostPublicationInputs.userRepostsCounterWitness));
  const initialTargetsRepostsCounters = Field(job.data.proveRepostPublicationInputs.initialTargetsRepostsCounters);
  const latestTargetsRepostsCounters = Field(job.data.proveRepostPublicationInputs.latestTargetsRepostsCounters);
  const targetRepostsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostPublicationInputs.targetRepostsCounterWitness));
  const initialReposts = Field(job.data.proveRepostPublicationInputs.initialReposts);
  const latestReposts = Field(job.data.proveRepostPublicationInputs.latestReposts);
  const repostWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostPublicationInputs.repostWitness));

  
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

  const transition = RepostsTransition.fromJSON(JSON.parse(job.data.proveRepostDeletionInputs.transition));
  const signature = Signature.fromBase58(job.data.proveRepostDeletionInputs.signature);
  const targets = Field(job.data.proveRepostDeletionInputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveRepostDeletionInputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostDeletionInputs.targetWitness));
  const currentAllRepostsCounter = Field(job.data.proveRepostDeletionInputs.currentAllRepostsCounter);
  const initialRepostState = RepostState.fromJSON(JSON.parse(job.data.proveRepostDeletionInputs.initialRepostState)) as RepostState;
  const usersRepostsCounters = Field(job.data.proveRepostDeletionInputs.usersRepostsCounters);
  const targetsRepostsCounters = Field(job.data.proveRepostDeletionInputs.targetsRepostsCounters);
  const initialReposts = Field(job.data.proveRepostDeletionInputs.initialReposts);
  const latestReposts = Field(job.data.proveRepostDeletionInputs.latestReposts);
  const repostWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostDeletionInputs.repostWitness));
  const deletionBlockHeight = Field(job.data.proveRepostDeletionInputs.blockHeight);
  
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

  const transition = RepostsTransition.fromJSON(JSON.parse(job.data.proveRepostRestorationInputs.transition));
  const signature = Signature.fromBase58(job.data.proveRepostRestorationInputs.signature);
  const targets = Field(job.data.proveRepostRestorationInputs.targets);
  const postState = PostState.fromJSON(JSON.parse(job.data.proveRepostRestorationInputs.postState)) as PostState;
  const targetWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostRestorationInputs.targetWitness));
  const currentAllRepostsCounter = Field(job.data.proveRepostRestorationInputs.currentAllRepostsCounter);
  const initialRepostState = RepostState.fromJSON(JSON.parse(job.data.proveRepostRestorationInputs.initialRepostState)) as RepostState;
  const usersRepostsCounters = Field(job.data.proveRepostRestorationInputs.usersRepostsCounters);
  const targetsRepostsCounters = Field(job.data.proveRepostRestorationInputs.targetsRepostsCounters);
  const initialReposts = Field(job.data.proveRepostRestorationInputs.initialReposts);
  const latestReposts = Field(job.data.proveRepostRestorationInputs.latestReposts);
  const repostWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.proveRepostRestorationInputs.repostWitness));
  const restorationBlockHeight = Field(job.data.proveRepostRestorationInputs.blockHeight);
  
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