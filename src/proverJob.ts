import { SandboxedJob } from 'bullmq';
import { Signature, MerkleMapWitness, PublicKey, CircuitString, Field, Cache } from 'o1js';
import { PostState, PostsTransition, Posts } from 'wrdhom';

// ============================================================================

export default async (job: SandboxedJob) => {
  const startTime = performance.now();
  console.log('Compiling Posts ZkProgram...');
  await Posts.compile({cache: Cache.FileSystem(job.data.provePostInput.cachePath)});
  console.log('Compiled');
  const endTime = performance.now();
  console.log(`${(endTime - startTime)/1000/60} minutes`);

  const transition = PostsTransition.fromJSON(JSON.parse(job.data.provePostInput.transition));
  const signature = Signature.fromBase58(job.data.provePostInput.signature);
  const postState = PostState.fromJSON(JSON.parse(job.data.provePostInput.postState)) as PostState;
  const postWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.provePostInput.postWitness));
  const userPostsCounterWitness = MerkleMapWitness.fromJSON(JSON.parse(job.data.provePostInput.userPostsCounterWitness));

  const provePostOutput = await provePost(
    transition,
    signature,
    postState,
    postWitness,
    userPostsCounterWitness
  );
  return provePostOutput
};

// ============================================================================

async function provePost(transition: PostsTransition, signature: Signature, postState: PostState,
    postWitness: MerkleMapWitness, userPostsCounterWitness: MerkleMapWitness) {
      
      const proof = await Posts.provePostPublishingTransition(
        transition,
        signature,
        postState.allPostsCounter.sub(1),
        transition.initialUsersPostsCounters,
        transition.latestUsersPostsCounters,
        postState.userPostsCounter.sub(1),
        userPostsCounterWitness,
        transition.initialPosts,
        transition.latestPosts,
        postState,
        postWitness
      );
      console.log('Proof created');
  
      return {transition: JSON.stringify(transition), proof: JSON.stringify(proof.toJSON())};
    }