import { Signature, Field, MerkleMapWitness } from 'o1js';
import { PostState, PostsTransition, Posts, PostsProof } from 'wrdhom';
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
    
    const provePostOutput = await provePost(
    transition,
    signature,
    postState,
    initialUsersPostsCounters,
    latestUsersPostsCounters,
    initialPosts,
    latestPosts,
    postWitness,
    userPostsCounterWitness
    );
    return provePostOutput;

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

  const transition = PostsTransition.fromJSON(JSON.parse(job.data.provePostInput.transition));
  const signature = Signature.fromBase58(job.data.provePostInput.signature);
  const currentAllPostsCounter = Field(job.data.provePostInput.currentAllPostsCounter);
  const usersPostsCounters = Field(job.data.provePostInput.usersPostsCounters);
  const initialPostState = PostState.fromJSON(JSON.parse(job.data.provePostInput.initialPostState)) as PostState;
  const initialPosts = Field(job.data.provePostInput.initialPosts);
  const latestPosts = Field(job.data.provePostInput.latestPosts);
  const postWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.provePostInput.postWitness));
  const deletionBlockHeight = Field(job.data.provePostInput.deletionBlockHeight);
  
  const provePostOutput = await provePostDeletion(
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
  return provePostOutput;

}, { connection: connection, lockDuration: 600000 });

// ============================================================================

async function provePost(transition: PostsTransition, signature: Signature, postState: PostState,
    initialUsersPostsCounters: Field, latestUsersPostsCounters: Field, initialPosts: Field,
    latestPosts: Field, postWitness: MerkleMapWitness, userPostsCounterWitness: MerkleMapWitness) {
        
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
  }

// ============================================================================

async function provePostDeletion(transition: PostsTransition, signature: Signature,
currentAllPostsCounter: Field, usersPostsCounters: Field, initialPosts: Field, latestPosts: Field,
initialPostState: PostState, postWitness: MerkleMapWitness, deletionBlockHeight: Field
) {
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
}

// ============================================================================