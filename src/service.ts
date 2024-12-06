import fastify from 'fastify';
import {
  CircuitString,
  PublicKey,
  Signature,
  Field,
  MerkleMap,
  Poseidon,
  Bool,
  PrivateKey
} from 'o1js';
import cors from '@fastify/cors';
import { PrismaClient, Prisma } from '@prisma/client';
import { createFileEncoderStream, CAREncoderStream } from 'ipfs-car';
import { Blob } from '@web-std/file';
import * as dotenv from 'dotenv';
import {
  regeneratePostsZkAppState,
  regenerateReactionsZkAppState,
  regenerateCommentsZkAppState,
  regenerateRepostsZkAppState,
  getLastPostsState,
  getLastReactionsState,
  getLastCommentsState,
  getLastRepostsState
} from './utils/state.js';
import { CommentState, PostState, ReactionState, fieldToFlagTargetAsReposted,
  RepostState,
  fieldToFlagPostsAsDeleted,
  fieldToFlagPostsAsRestored,
  fieldToFlagCommentsAsDeleted,
  fieldToFlagCommentsAsRestored,
  fieldToFlagRepostsAsDeleted,
  fieldToFlagRepostsAsRestored,
  fieldToFlagReactionsAsDeleted,
  fieldToFlagReactionsAsRestored,
  Config
} from 'wrdhom';
import fs from 'fs/promises';
import { fastifySchedule } from '@fastify/schedule';
import { SimpleIntervalJob, AsyncTask } from 'toad-scheduler';

// ============================================================================

// Load .env
dotenv.config();

// Set up client for PostgreSQL for structured data
const prisma = new PrismaClient();

// ============================================================================

const configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const configPosts = configJson.deployAliases['posts'];
const serverKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(configPosts.feepayerKeyPath, 'utf8'));
const serverKey = PrivateKey.fromBase58(serverKeysBase58.privateKey);

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

console.log('totalNumberOfPosts: ' + postsContext.totalNumberOfPosts);
console.log('usersPostsCountersRoot: ' + postsContext.usersPostsCountersMap.getRoot().toString());
console.log('postsRoot: ' + postsContext.postsMap.getRoot().toString());
console.log('postsLastUpdate: ' + postsContext.postsLastUpdate);
console.log('postsStateHistoryRoot: ' + postsContext.postsStateHistoryMap.getRoot().toString());

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

console.log('totalNumberOfReactions: ' + reactionsContext.totalNumberOfReactions);
console.log('usersReactionsCountersRoot: ' + usersReactionsCountersMap.getRoot().toString());
console.log('targetsReactionsCountersRoot: ' + targetsReactionsCountersMap.getRoot().toString());
console.log('reactionsRoot: ' + reactionsMap.getRoot().toString());
console.log('reactionsLastUpdate: ' + reactionsContext.reactionsLastUpdate);
console.log('reactionsStateHistoryRoot: ' + reactionsContext.reactionsStateHistoryMap.getRoot().toString());

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

console.log('totalNumberOfComments: ' + commentsContext.totalNumberOfComments);
console.log('usersCommentsCountersRoot: ' + usersCommentsCountersMap.getRoot().toString());
console.log('targetsCommentsCountersRoot: ' + targetsCommentsCountersMap.getRoot().toString());
console.log('commentsRoot: ' + commentsMap.getRoot().toString());
console.log('commentsLastUpdate: ' + commentsContext.commentsLastUpdate);
console.log('commentsStateHistoryRoot: ' + commentsContext.commentsStateHistoryMap.getRoot().toString());

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

console.log('totalNumberOfReposts: ' + repostsContext.totalNumberOfReposts);
console.log('usersRepostsCountersRoot: ' + usersRepostsCountersMap.getRoot().toString());
console.log('targetsRepostsCountersRoot: ' + targetsRepostsCountersMap.getRoot().toString());
console.log('repostsRoot: ' + repostsMap.getRoot().toString());
console.log('repostsLastUpdate: ' + repostsContext.repostsLastUpdate);
console.log('repostsStateHistoryRoot: ' + repostsContext.repostsStateHistoryMap.getRoot().toString());

// Create posts and comments content directories if they don't exist 

try {
  await fs.access('./posts/');
  console.log('./posts/ directory exists');
} catch (e: any) {
  if (e.code === 'ENOENT') {
    await fs.mkdir('./posts/');
    console.log('./posts/ directory created');
  } else {
    console.error(e);
  }
}

try {
  await fs.access('./comments/');
  console.log('./comments/ directory exists');
} catch (e: any) {
  if (e.code === 'ENOENT') {
    await fs.mkdir('./comments/');
    console.log('./comments/ directory created');
  } else {
    console.error(e);
  }
}

// ============================================================================

// Instantiate Fastify server and set up configurations

const server = fastify();
await server.register(cors, { 
  origin: '*',
});

// Schedule periodical synchronization with zkApp state

const syncStateTask = new AsyncTask(
  'Sync with zkApp state',
  async () => {

    let previousPostsRoot = postsContext.postsMap.getRoot().toString();
    await regeneratePostsZkAppState(postsContext);
    if (previousPostsRoot !== postsContext.postsMap.getRoot().toString()) {
      console.log('totalNumberOfPosts: ' + postsContext.totalNumberOfPosts);
      console.log('usersPostsCountersRoot: ' + postsContext.usersPostsCountersMap.getRoot().toString());
      console.log('postsRoot: ' + postsContext.postsMap.getRoot().toString());
      console.log('postsLastUpdate: ' + postsContext.postsLastUpdate);
      console.log('postsStateHistoryRoot: ' + postsContext.postsStateHistoryMap.getRoot().toString());
    }

    let previousReactionsRoot = reactionsContext.reactionsMap.getRoot().toString();
    await regenerateReactionsZkAppState(reactionsContext);
    if (previousReactionsRoot !== reactionsContext.reactionsMap.getRoot().toString()) {
      console.log('totalNumberOfReactions: ' + reactionsContext.totalNumberOfReactions);
      console.log('usersReactionsCountersRoot: ' + usersReactionsCountersMap.getRoot().toString());
      console.log('targetsReactionsCountersRoot: ' + targetsReactionsCountersMap.getRoot().toString());
      console.log('reactionsRoot: ' + reactionsMap.getRoot().toString());
      console.log('reactionsLastUpdate: ' + reactionsContext.reactionsLastUpdate);
      console.log('reactionsStateHistoryRoot: ' + reactionsContext.reactionsStateHistoryMap.getRoot().toString());
    }

    let previousCommentsRoot = commentsContext.commentsMap.getRoot().toString();
    await regenerateCommentsZkAppState(commentsContext);
    if (previousCommentsRoot !== commentsContext.commentsMap.getRoot().toString()) {
      console.log('totalNumberOfComments: ' + commentsContext.totalNumberOfComments);
      console.log('usersCommentsCountersRoot: ' + usersCommentsCountersMap.getRoot().toString());
      console.log('targetsCommentsCountersRoot: ' + targetsCommentsCountersMap.getRoot().toString());
      console.log('commentsRoot: ' + commentsMap.getRoot().toString());
      console.log('commentsLastUpdate: ' + commentsContext.commentsLastUpdate);
      console.log('commentsStateHistoryRoot: ' + commentsContext.commentsStateHistoryMap.getRoot().toString());
    }

    let previousRepostsRoot = repostsContext.repostsMap.getRoot().toString();
    await regenerateRepostsZkAppState(repostsContext);
    if (previousRepostsRoot !== repostsContext.repostsMap.getRoot().toString()) {
      console.log('totalNumberOfReposts: ' + repostsContext.totalNumberOfReposts);
      console.log('usersRepostsCountersRoot: ' + usersRepostsCountersMap.getRoot().toString());
      console.log('targetsRepostsCountersRoot: ' + targetsRepostsCountersMap.getRoot().toString());
      console.log('repostsRoot: ' + repostsMap.getRoot().toString());
      console.log('repostsLastUpdate: ' + repostsContext.repostsLastUpdate);
      console.log('repostsStateHistoryRoot: ' + repostsContext.repostsStateHistoryMap.getRoot().toString());
    }

  },
  (e) => {console.error(e)}
)
const syncStateJob = new SimpleIntervalJob({ seconds: 10, }, syncStateTask)

server.register(fastifySchedule);
server.ready().then(() => {
  server.scheduler.addSimpleIntervalJob(syncStateJob)
});

// Listen to port 3001

server.listen({ port: 3001 }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Server listening at ${address}`)
});

// ============================================================================

server.post<{Body: SignedPost}>('/posts', async (request) => {

  // If post already exists but it was previously deleted, ask user if they want to restore it
  const posterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
  const postContentIDAsField = Field(request.body.signedData.data[0]);
  const postKey = Poseidon.hash([posterAddressAsField, postContentIDAsField]);

  const post = await prisma.posts.findUnique({
    where: {
      postKey: postKey.toString()
    }
  });

  if (post !== null && post?.deletionBlockHeight === 0n) {
    return {message: 'Post already exists'}
  }

  if (post !== null && Number(post?.deletionBlockHeight) !== 0) {
    return {
      postKey: postKey.toString(),
      message: 'Restore?'
    }
  }

  // Check that content and signed CID match
  const signature = Signature.fromBase58(request.body.signedData.signature);
  const postContentIDAsBigInt = postContentIDAsField.toBigInt();
  const file = new Blob([request.body.post]);
  console.log(request.body.post);
  const postCID = await getCID(file);
  console.log('postCID: ' + postCID);
  const postCIDAsBigInt = CircuitString.fromString(postCID.toString()).hash().toBigInt();
  const isContentValid = postCIDAsBigInt === postContentIDAsBigInt;
  console.log('Is Content Valid? ' + isContentValid);

  if (isContentValid) {

    // Check that the signature is valid
    const isSigned = signature.verify(
      posterAddress,
      [CircuitString.fromString(postCID.toString()).hash()]
    ).toBoolean();
    console.log('Is Signed? ' + isSigned);
    
    if (isSigned) {
      const allPostsCounter = (await prisma.posts.count()) + 1;
      console.log('allPostsCounter: ' + allPostsCounter);

      const postsFromUser = await prisma.posts.findMany({
        where: {
          posterAddress: posterAddress.toBase58()
        }
      });
      const userPostsCounter = postsFromUser.length + 1;
      console.log('userPostsCounter: ' + userPostsCounter);

      await fs.writeFile('./posts/' + postCID, request.body.post, 'utf-8');
      await createSQLPost(postKey, signature, posterAddress, allPostsCounter, userPostsCounter, postCID);
      return {message: 'Valid Post!'};
    } else {
        return `Post isn't signed`;
    }
  } else {
      return `Derived post CID, doesn't match signed post CID`;
  }
});

// ============================================================================

server.post<{Body: SignedData}>('/reactions', async (request) => {
  const post = await prisma.posts.findUnique({
    where: {
      postKey: request.body.data[0],
      postBlockHeight: {
        not: 0
      }
    }
  });

  if (post?.posterAddress === undefined) {
    return `The target you are trying to react to doesn't exist`;
  }

  const signature = Signature.fromBase58(request.body.signature);
  const reactorAddress = PublicKey.fromBase58(request.body.publicKey);
  const reactionEmojiCodePoint = Number(request.body.data[1]);
  const emojisCodePoints = ['👍', '👎', '😂', '🤔', '😢', '😠', '😎', '🔥',
  '👀', '🩶', '💔', '🙏','🤝', '🤌', '🙌', '🤭', '😳', '😭', '🤯', '😡',
  '👽', '😈', '💀', '💯'].map(emoji => emoji.codePointAt(0));
  const emojisSetCodePoints = new Set(emojisCodePoints);
  if (emojisSetCodePoints.has(reactionEmojiCodePoint)) {

    const posterAddressAsField = Poseidon.hash(PublicKey.fromBase58(post.posterAddress).toFields());
    const postContentIDAsField = CircuitString.fromString(post.postContentID).hash();
    const targetKey = Poseidon.hash([posterAddressAsField, postContentIDAsField]);
    const isSigned = signature.verify(reactorAddress, [
      targetKey,
      Field(request.body.data[1])
    ]).toBoolean();
    const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
    const reactionCodePointAsField = Field(reactionEmojiCodePoint);
    const reactionKey = Poseidon.hash([targetKey, reactorAddressAsField, reactionCodePointAsField]);

    const reaction = await prisma.reactions.findUnique({
      where: {
        reactionKey: reactionKey.toString()
      }
    });

    if (reaction !== null && Number(reaction?.deletionBlockHeight) !== 0) {
      return {
        reactionKey: reactionKey.toString(),
        message: 'Restore?'
      }
    }

    if (isSigned) {
      console.log(String.fromCodePoint(reactionEmojiCodePoint));
      const allReactionsCounter = (await prisma.reactions.count()) + 1;
      console.log('allReactionsCounter: ' + allReactionsCounter);

      const reactionsFromReactor = await prisma.reactions.findMany({
        where: {
          reactorAddress: reactorAddress.toBase58()
        }
      });
      const userReactionsCounter = reactionsFromReactor.length + 1;
      console.log('userReactionsCounter: ' + userReactionsCounter);

      const reactionsForTarget = await prisma.reactions.findMany({
        where: {
          targetKey: targetKey.toString()
        }
      });
      const targetReactionsCounter = reactionsForTarget.length + 1;
      console.log('targetReactionsCounter: ' + targetReactionsCounter);

      await createSQLReaction(reactionKey, targetKey, request.body.publicKey, reactionEmojiCodePoint,
        allReactionsCounter, userReactionsCounter, targetReactionsCounter, request.body.signature);
      return 'Valid Reaction!';
    } else {
      return 'Reaction message is not signed';
    }
  } else {
    return `The reaction value isn't a valid emoji`;
  }
});

// ============================================================================

server.post<{Body: SignedComment}>('/comments', async (request) => {
  const post = await prisma.posts.findUnique({
    where: {
      postKey: request.body.signedData.data[0],
      postBlockHeight: {
        not: 0
      }
    }
  });

  if (post === null) {
    return `The target you are trying to comment on doesn't exist`;
  }

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const commenterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
  const posterAddressAsField = Poseidon.hash(PublicKey.fromBase58(post.posterAddress).toFields());
  const postContentIDAsField = CircuitString.fromString(post.postContentID).hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDAsField]);
  const commentContentIDAsField = Field(request.body.signedData.data[1]);
  const commentContentIDAsBigInt = commentContentIDAsField.toBigInt();
  const commentKey = Poseidon.hash([targetKey, commenterAddressAsField, commentContentIDAsField]);

  const comment = await prisma.comments.findUnique({
    where: {
      commentKey: commentKey.toString()
    }
  });

  if (comment !== null && comment?.deletionBlockHeight === 0n) {
    return {message: 'Comment already exists'}
  }

  if (comment !== null && Number(comment?.deletionBlockHeight) !== 0) {
    return {
      commentKey: commentKey.toString(),
      message: 'Restore?'
    }
  }

  // Check that content and signed CID match
  const file = new Blob([request.body.comment]);
  const commentCID = await getCID(file);
  console.log('commentCID: ' + commentCID);
  const commentCIDAsBigInt = CircuitString.fromString(commentCID.toString()).hash().toBigInt();
  const isContentValid = commentCIDAsBigInt === commentContentIDAsBigInt;
  console.log('Is Content Valid? ' + isContentValid);

  if (isContentValid) {
    // Check that the signature is valid
    const isSigned = signature.verify(
      commenterAddress,
      [
        targetKey,
        CircuitString.fromString(commentCID.toString()).hash()
      ]
    ).toBoolean();
    console.log('Is Signed? ' + isSigned);
    
    if (isSigned) {
      console.log(request.body.comment);
      const allCommentsCounter = (await prisma.comments.count()) + 1;
      console.log('allCommentsCounter: ' + allCommentsCounter);

      const commentsFromCommenter = await prisma.comments.findMany({
        where: {
          commenterAddress: commenterAddress.toBase58()
        }
      });
      const userCommentsCounter = commentsFromCommenter.length + 1;
      console.log('userCommentsCounter: ' + userCommentsCounter);

      const commentsForTarget = await prisma.comments.findMany({
        where: {
          targetKey: targetKey.toString()
        }
      });
      const targetCommentsCounter = commentsForTarget.length + 1;
      console.log('targetCommentsCounter: ' + targetCommentsCounter);

      await fs.writeFile('./comments/' + commentCID, request.body.comment, 'utf-8');
      await createSQLComment(commentKey, targetKey, request.body.signedData.publicKey,
        commentCID, allCommentsCounter, userCommentsCounter, targetCommentsCounter,
        request.body.signedData.signature);
      return {message: 'Valid Comment!'};
    } else {
        return `Comment isn't signed`;
    }
  } else {
      return `Derived post CID, doesn't match signed comment CID`;
  }
});

// ============================================================================

server.post<{Body: SignedData}>('/reposts', async (request) => {
  try {
  const post = await prisma.posts.findUnique({
    where: {
      postKey: request.body.data[0],
      postBlockHeight: {
        not: 0
      }
    }
  });

  if (post?.posterAddress === null) {
    return `The target you are trying to repost doesn't exist`;
  }

  const signature = Signature.fromBase58(request.body.signature);
  const reposterAddress = PublicKey.fromBase58(request.body.publicKey);
  const targetKey = Field(request.body.data[0]);
  const isSigned = signature.verify(reposterAddress, [
    targetKey,
    fieldToFlagTargetAsReposted
  ]).toBoolean();
  const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());
  const repostKey = Poseidon.hash([targetKey, reposterAddressAsField]);

  const repost = await prisma.reposts.findUnique({
    where: {
      repostKey: repostKey.toString()
    }
  });

  if (repost !== null && repost?.deletionBlockHeight === 0n) {
    return {message: 'Repost already exists'}
  }

  if (repost !== null && repost?.deletionBlockHeight !== 0n) {
    return {
      repostKey: repostKey.toString(),
      message: 'Restore?'
    }
  }

  if (isSigned) {
    console.log(request.body.data[0]);
    const allRepostsCounter = (await prisma.reposts.count()) + 1;
    console.log('allRepostsCounter: ' + allRepostsCounter);

    const repostsFromReposter = await prisma.reposts.findMany({
      where: {
        reposterAddress: reposterAddress.toBase58()
      }
    });
    const userRepostsCounter = repostsFromReposter.length + 1;
    console.log('userRepostsCounter: ' + userRepostsCounter);

    const repostsForTarget = await prisma.reposts.findMany({
      where: {
        targetKey: targetKey.toString()
      }
    });
    const targetRepostsCounter = repostsForTarget.length + 1;
    console.log('targetRepostsCounter: ' + targetRepostsCounter);

    await createSQLRepost(repostKey, targetKey, request.body.publicKey, allRepostsCounter,
      userRepostsCounter, targetRepostsCounter, request.body.signature);
    return 'Valid Repost!';
  } else {
    return 'Repost message is not signed';
  }
} catch (e) {
  console.log(e)
}
});

// ============================================================================

server.patch<{Body: SignedPostDeletion}>('/posts/delete', async (request) => {

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const posterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);

  const post = await prisma.posts.findUnique({
    where: {
      postKey: request.body.postKey
    }
  });

  if (post !== null && post?.deletionBlockHeight !== 0n) {
    return 'Post is already deleted';
  }

  if (post !== null && post?.status !== 'loaded') {
    return `Post is still being confirmed. Status: ${post?.status}`;
  }

  const postContentID = CircuitString.fromString(post!.postContentID);

  const postState = new PostState({
    posterAddress: posterAddress,
    postContentID: postContentID,
    allPostsCounter: Field(post!.allPostsCounter),
    userPostsCounter: Field(post!.userPostsCounter),
    postBlockHeight: Field(post!.postBlockHeight),
    deletionBlockHeight: Field(post!.deletionBlockHeight),
    restorationBlockHeight: Field(post!.restorationBlockHeight)
  });

  const postStateHash = postState.hash();

  const isSigned = signature.verify(posterAddress, [
    postStateHash,
    fieldToFlagPostsAsDeleted
  ]);

  // Check that message to delete post is signed
  if (isSigned) {
    console.log('Deleting post with key: ' + request.body.postKey);

    await prisma.posts.update({
      where: {
        postKey: request.body.postKey
      },
      data: {
        status: 'delete',
        pendingSignature: request.body.signedData.signature
      }
    });

    return 'Valid Post Deletion!';
  } else {
    return 'Post deletion message is not signed';
  }
});

// ============================================================================

server.patch<{Body: SignedCommentDeletion}>('/comments/delete', async (request) => {

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const commenterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const targetKey = request.body.targetKey;

  const comment = await prisma.comments.findUnique({
    where: {
      commentKey: request.body.commentKey
    }
  });

  if (comment !== null && comment?.deletionBlockHeight !== 0n) {
    return 'Comment is already deleted';
  }

  if (comment !== null && comment?.status !== 'loaded') {
    return `Comment is still being confirmed. Status: ${comment?.status}`;
  }

  const commentContentID = CircuitString.fromString(comment!.commentContentID);

  const commentState = new CommentState({
    isTargetPost: Bool(comment!.isTargetPost),
    targetKey: Field(targetKey),
    commenterAddress: commenterAddress,
    commentContentID: commentContentID,
    allCommentsCounter: Field(comment!.allCommentsCounter),
    userCommentsCounter: Field(comment!.userCommentsCounter),
    targetCommentsCounter: Field(comment!.targetCommentsCounter),
    commentBlockHeight: Field(comment!.commentBlockHeight),
    deletionBlockHeight: Field(comment!.deletionBlockHeight),
    restorationBlockHeight: Field(comment!.restorationBlockHeight)
  });

  const commentStateHash = commentState.hash();

  const isSigned = signature.verify(commenterAddress, [
    commentStateHash,
    fieldToFlagCommentsAsDeleted
  ]);

  // Check that message to delete comment is signed
  if (isSigned) {
    console.log('Deleting comment with key: ' + request.body.commentKey);

    await prisma.comments.update({
      where: {
        commentKey: request.body.commentKey
      },
      data: {
        status: 'delete',
        pendingSignature: request.body.signedData.signature
      }
    });

    return 'Valid Comment Deletion!';
  } else {
    return 'Comment deletion message is not signed';
  }
});

// ============================================================================

server.patch<{Body: SignedReactionDeletion}>('/reactions/delete', async (request) => {

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const reactorAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
  const initialReactionState = ReactionState.fromJSON(JSON.parse(request.body.reactionState));
  const reactionKey = Poseidon.hash([initialReactionState.targetKey, reactorAddressAsField, initialReactionState.reactionCodePoint]);
  const reactionKeyAsString = reactionKey.toString();

  const reaction = await prisma.reactions.findUnique({
    where: {
      reactionKey: reactionKeyAsString
    }
  });

  if (reaction !== null && reaction?.deletionBlockHeight !== 0n) {
    return 'Reaction is already deleted';
  }
  
  if (reaction !== null && reaction?.status !== 'loaded') {
    return `Reaction is still being confirmed. Status: ${reaction?.status}`;
  }

  const reactionState = new ReactionState({
    isTargetPost: Bool(reaction!.isTargetPost),
    targetKey: Field(reaction!.targetKey),
    reactorAddress: reactorAddress,
    reactionCodePoint: Field(reaction!.reactionCodePoint),
    allReactionsCounter: Field(reaction!.allReactionsCounter),
    userReactionsCounter: Field(reaction!.userReactionsCounter),
    targetReactionsCounter: Field(reaction!.targetReactionsCounter),
    reactionBlockHeight: Field(reaction!.reactionBlockHeight),
    deletionBlockHeight: Field(reaction!.deletionBlockHeight),
    restorationBlockHeight: Field(reaction!.restorationBlockHeight)
  });

  const reactionStateHash = reactionState.hash();

  const isSigned = signature.verify(reactorAddress, [
    reactionStateHash,
    fieldToFlagReactionsAsDeleted
  ]);

  // Check that message to delete reaction is signed
  if (isSigned) {
    console.log('Deleting reaction with key: ' + reactionKeyAsString);

    await prisma.reactions.update({
      where: {
        reactionKey: reactionKeyAsString
      },
      data: {
        status: 'delete',
        pendingSignature: request.body.signedData.signature
      }
    });

    return 'Valid Reaction Deletion!';
  } else {
    return 'Reaction deletion message is not signed';
  }
});

// ============================================================================

server.patch<{Body: SignedRepostDeletion}>('/reposts/delete', async (request) => {

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const reposterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const targetKey = request.body.targetKey;
  const repostKey = request.body.repostKey;

  const repost = await prisma.reposts.findUnique({
    where: {
      repostKey: repostKey
    }
  });

  if (repost !== null && repost?.deletionBlockHeight !== 0n) {
    return 'Repost is already deleted';
  }

  if (repost !== null && repost?.status !== 'loaded') {
    return `Repost is still being confirmed. Status: ${repost?.status}`;
  }

  const repostState = new RepostState({
    isTargetPost: Bool(repost!.isTargetPost),
    targetKey: Field(targetKey),
    reposterAddress: reposterAddress,
    allRepostsCounter: Field(repost!.allRepostsCounter),
    userRepostsCounter: Field(repost!.userRepostsCounter),
    targetRepostsCounter: Field(repost!.targetRepostsCounter),
    repostBlockHeight: Field(repost!.repostBlockHeight),
    deletionBlockHeight: Field(repost!.deletionBlockHeight),
    restorationBlockHeight: Field(repost!.restorationBlockHeight)
  });

  const repostStateHash = repostState.hash();

  const isSigned = signature.verify(reposterAddress, [
    repostStateHash,
    fieldToFlagRepostsAsDeleted
  ]);

  // Check that message to delete repost is signed
  if (isSigned) {
    console.log('Deleting repost with key: ' + repostKey);

    await prisma.reposts.update({
      where: {
        repostKey: repostKey
      },
      data: {
        status: 'delete',
        pendingSignature: request.body.signedData.signature
      }
    });

    return 'Valid Repost Deletion!';
  } else {
    return 'Repost deletion message is not signed';
  }
});

// ============================================================================

server.patch<{Body: SignedPostRestoration}>('/posts/restore', async (request) => {

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const posterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const postKey = request.body.postKey;

  const post = await prisma.posts.findUnique({
    where: {
      postKey: postKey
    }
  });

  if(Number(post!.deletionBlockHeight) === 0) {
    return 'Post has not been deleted, so it cannot be restored';
  }

  if (post !== null && post?.status !== 'loaded') {
    return `Post is still being confirmed. Status: ${post?.status}`;
  }

  const postContentID = CircuitString.fromString(post!.postContentID);

  const postState = new PostState({
    posterAddress: posterAddress,
    postContentID: postContentID,
    allPostsCounter: Field(post!.allPostsCounter),
    userPostsCounter: Field(post!.userPostsCounter),
    postBlockHeight: Field(post!.postBlockHeight),
    deletionBlockHeight: Field(post!.deletionBlockHeight),
    restorationBlockHeight: Field(post!.restorationBlockHeight)
  });

  const postStateHash = postState.hash();

  const isSigned = signature.verify(posterAddress, [
    postStateHash,
    fieldToFlagPostsAsRestored
  ]);

  // Check that message to restore post is signed
  if (isSigned) {
    console.log('Restoring post with key: ' + postKey);
    await prisma.posts.update({
      where: {
        postKey: postKey
      },
      data: {
        status: 'restore',
        pendingSignature: request.body.signedData.signature
      }
    });

    return 'Valid Post Restoration!';
  } else {
    return 'Post restoration message is not signed';
  }
});

// ============================================================================

server.patch<{Body: SignedCommentRestoration}>('/comments/restore', async (request) => {

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const commenterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);

  const comment = await prisma.comments.findUnique({
    where: {
      commentKey: request.body.commentKey
    }
  });

  if(Number(comment!.deletionBlockHeight) === 0) {
    return 'Comment has not been deleted, so it cannot be restored';
  }

  if (comment !== null && comment?.status !== 'loaded') {
    return `Comment is still being confirmed. Status: ${comment?.status}`;
  }

  const commentContentID = CircuitString.fromString(comment!.commentContentID);

  const commentState = new CommentState({
    isTargetPost: Bool(true),
    targetKey: Field(request.body.targetKey),
    commenterAddress: commenterAddress,
    commentContentID: commentContentID,
    allCommentsCounter: Field(comment!.allCommentsCounter),
    userCommentsCounter: Field(comment!.userCommentsCounter),
    targetCommentsCounter: Field(comment!.targetCommentsCounter),
    commentBlockHeight: Field(comment!.commentBlockHeight),
    deletionBlockHeight: Field(comment!.deletionBlockHeight),
    restorationBlockHeight: Field(comment!.restorationBlockHeight)
  });

  const isSigned = signature.verify(commenterAddress, [
    commentState.hash(),
    fieldToFlagCommentsAsRestored
  ]);

  // Check that message to restore comment is signed
  if (isSigned) {
    console.log('Restoring comment with key: ' + request.body.commentKey);

    await prisma.comments.update({
      where: {
        commentKey: request.body.commentKey
      },
      data: {
        status: 'restore',
        pendingSignature: request.body.signedData.signature
      }
    });

    return 'Valid Comment Restoration!';
  } else {
    return 'Comment restoration message is not signed';
  }
});

// ============================================================================

server.patch<{Body: SignedRepostRestoration}>('/reposts/restore', async (request) => {

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const reposterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const repostKey = request.body.repostKey;

  const repost = await prisma.reposts.findUnique({
    where: {
      repostKey: repostKey
    }
  });

  if(repost!.deletionBlockHeight === 0n) {
    return 'Repost has not been deleted, so it cannot be restored';
  }

  if (repost !== null && repost?.status !== 'loaded') {
    return `Repost is still being confirmed. Status: ${repost?.status}`;
  }

  const repostState = new RepostState({
    isTargetPost: Bool(true),
    targetKey: Field(request.body.targetKey),
    reposterAddress: reposterAddress,
    allRepostsCounter: Field(repost!.allRepostsCounter),
    userRepostsCounter: Field(repost!.userRepostsCounter),
    targetRepostsCounter: Field(repost!.targetRepostsCounter),
    repostBlockHeight: Field(repost!.repostBlockHeight),
    deletionBlockHeight: Field(repost!.deletionBlockHeight),
    restorationBlockHeight: Field(repost!.restorationBlockHeight)
  });

  const isSigned = signature.verify(reposterAddress, [
    repostState.hash(),
    fieldToFlagRepostsAsRestored
  ]);

  // Check that message to restore repost is signed
  if (isSigned) {
    console.log('Restoring repost with key: ' + request.body.repostKey);

    await prisma.reposts.update({
      where: {
        repostKey: request.body.repostKey
      },
      data: {
        status: 'restore',
        pendingSignature: request.body.signedData.signature
      }
    });

    return 'Valid Repost Restoration!';
  } else {
    return 'Repost restoration message is not signed';
  }
});

// ============================================================================

server.patch<{Body: SignedReactionRestoration}>('/reactions/restore', async (request) => {

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const reactorAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const reactionKey = request.body.reactionKey;

  const reaction = await prisma.reactions.findUnique({
    where: {
      reactionKey: reactionKey
    }
  });

  if(Number(reaction!.deletionBlockHeight) === 0) {
    return 'Reaction has not been deleted, so it cannot be restored';
  }

  if (reaction !== null && reaction?.status !== 'loaded') {
    return `Reaction is still being confirmed. Status: ${reaction?.status}`;
  }

  const reactionState = new ReactionState({
    isTargetPost: Bool(true),
    targetKey: Field(request.body.targetKey),
    reactorAddress: reactorAddress,
    reactionCodePoint: Field(reaction!.reactionCodePoint),
    allReactionsCounter: Field(reaction!.allReactionsCounter),
    userReactionsCounter: Field(reaction!.userReactionsCounter),
    targetReactionsCounter: Field(reaction!.targetReactionsCounter),
    reactionBlockHeight: Field(reaction!.reactionBlockHeight),
    deletionBlockHeight: Field(reaction!.deletionBlockHeight),
    restorationBlockHeight: Field(reaction!.restorationBlockHeight)
  });

  const isSigned = signature.verify(reactorAddress, [
    reactionState.hash(),
    fieldToFlagReactionsAsRestored
  ]);

  // Check that message to restore reaction is signed
  if (isSigned) {
    console.log('Restoring reaction with key: ' + request.body.reactionKey);

    await prisma.reactions.update({
      where: {
        reactionKey: request.body.reactionKey
      },
      data: {
        status: 'restore',
        pendingSignature: request.body.signedData.signature
      }
    });

    return 'Valid Reaction Restoration!';
  } else {
    return 'Reaction restoration message is not signed';
  }
});

// ============================================================================

server.get<{Querystring: PostsQuery}>('/posts', async (request) => {
  try {
    const { howMany, fromBlock, toBlock, profileAddress, postKey, currentUser } = request.query;

    if (postKey !== undefined) {
      const post = await prisma.posts.findUnique({
        where: {
          postKey: postKey
        }
      });

      const posterAddress = PublicKey.fromBase58(post!.posterAddress);
      const postContentID = CircuitString.fromString(post!.postContentID);

      const postState = new PostState({
        posterAddress: posterAddress,
        postContentID: postContentID,
        allPostsCounter: Field(post!.allPostsCounter),
        userPostsCounter: Field(post!.userPostsCounter),
        postBlockHeight: Field(post!.postBlockHeight),
        deletionBlockHeight: Field(post!.deletionBlockHeight),
        restorationBlockHeight: Field(post!.restorationBlockHeight)
      });

      return { postState: JSON.stringify(postState)};
    }

    let numberOfDeletedPosts: number;
    let posts: any[];

    if (profileAddress === undefined) {

      const lastPosts = (await prisma.posts.findMany({
        take: Number(howMany),
        orderBy: {
          allPostsCounter: 'desc'
        },
        where: {
          postBlockHeight: {
            not: 0,
            gte: fromBlock,
            lte: toBlock
          }
        }
      }));

      numberOfDeletedPosts = lastPosts.filter(post => post.deletionBlockHeight !== 0n).length;

      posts = await prisma.posts.findMany({
        take: Number(howMany) + numberOfDeletedPosts,
        orderBy: {
          allPostsCounter: 'desc'
        },
        where: {
          postBlockHeight: {
            not: 0,
            gte: fromBlock,
            lte: toBlock
          }
        }
      });

    } else {

      const lastPosts = (await prisma.posts.findMany({
        take: Number(howMany),
        orderBy: {
          allPostsCounter: 'desc'
        },
        where: {
          posterAddress: profileAddress,
          postBlockHeight: {
            not: 0,
            gte: fromBlock,
            lte: toBlock
          }
        }
      }));

      numberOfDeletedPosts = lastPosts.filter(post => post.deletionBlockHeight !== 0n).length;

      posts = await prisma.posts.findMany({
        take: Number(howMany) + numberOfDeletedPosts,
        orderBy: {
          allPostsCounter: 'desc'
        },
        where: {
          posterAddress: profileAddress,
          postBlockHeight: {
            not: 0,
            gte: fromBlock,
            lte: toBlock
          }
        }
      });

    }

    const postsResponse: PostsResponse[] = [];

    for (const post of posts) {
      const profileAddress = PublicKey.fromBase58(post.posterAddress);
      const postContentID = CircuitString.fromString(post.postContentID);
      const postKey = Field(post.postKey);
      const postWitness = postsMap.getWitness(postKey).toJSON();

      let content = '';
      if (post.deletionBlockHeight === BigInt(0)) {
        content = await fs.readFile('./posts/' + post.postContentID, 'utf8');
      }

      const postState = new PostState({
        posterAddress: profileAddress,
        postContentID: postContentID,
        allPostsCounter: Field(post.allPostsCounter),
        userPostsCounter: Field(post.userPostsCounter),
        postBlockHeight: Field(post.postBlockHeight),
        deletionBlockHeight: Field(post.deletionBlockHeight),
        restorationBlockHeight: Field(post.restorationBlockHeight)
      });

      const postReactions = await prisma.reactions.findMany({
        orderBy: {
          allReactionsCounter: 'desc'
        },
        where: {
          targetKey: post.postKey,
          reactionBlockHeight: {
            not: 0
          }
        }
      });
      const numberOfReactions = postReactions.length;
      const numberOfReactionsWitness = targetsReactionsCountersMap.getWitness(postKey).toJSON();
      const embeddedReactions: EmbeddedReactions[] = [];

      for (const reaction of postReactions) {
        const reactorAddress = PublicKey.fromBase58(reaction.reactorAddress);
        const reactionCodePointAsField = Field(reaction.reactionCodePoint);
        const reactionKey = Field(reaction.reactionKey);
        const reactionWitness = reactionsMap.getWitness(reactionKey).toJSON();

        const reactionState = new ReactionState({
          isTargetPost: Bool(reaction.isTargetPost),
          targetKey: postKey,
          reactorAddress: reactorAddress,
          reactionCodePoint: reactionCodePointAsField,
          allReactionsCounter: Field(reaction.allReactionsCounter),
          userReactionsCounter: Field(reaction.userReactionsCounter),
          targetReactionsCounter: Field(reaction.targetReactionsCounter),
          reactionBlockHeight: Field(reaction.reactionBlockHeight),
          deletionBlockHeight: Field(reaction.deletionBlockHeight),
          restorationBlockHeight: Field(reaction.restorationBlockHeight)
        });

        embeddedReactions.push({
          reactionState: JSON.stringify(reactionState),
          reactionWitness: JSON.stringify(reactionWitness)
        })
      }

      const postComments = await prisma.comments.findMany({
        orderBy: {
          allCommentsCounter: 'desc'
        },
        where: {
          targetKey: post.postKey,
          commentBlockHeight: {
            not: 0
          }
        }
      });
      const numberOfComments = postComments.length;
      const numberOfCommentsWitness = targetsCommentsCountersMap.getWitness(postKey).toJSON();
      const embeddedComments: EmbeddedComments[] = [];

      for (const comment of postComments) {
        const commenterAddress = PublicKey.fromBase58(comment.commenterAddress);
        const commentContentID = CircuitString.fromString(comment.commentContentID);
        const commentKey = Field(comment.commentKey);
        const commentWitness = commentsMap.getWitness(commentKey).toJSON();

        const commentState = new CommentState({
          isTargetPost: Bool(comment.isTargetPost),
          targetKey: postKey,
          commenterAddress: commenterAddress,
          commentContentID: commentContentID,
          allCommentsCounter: Field(comment.allCommentsCounter),
          userCommentsCounter: Field(comment.userCommentsCounter),
          targetCommentsCounter: Field(comment.targetCommentsCounter),
          commentBlockHeight: Field(comment.commentBlockHeight),
          deletionBlockHeight: Field(comment.deletionBlockHeight),
          restorationBlockHeight: Field(comment.restorationBlockHeight)
        });

        embeddedComments.push({
          commentState: JSON.stringify(commentState),
          commentWitness: JSON.stringify(commentWitness)
        })
      }

      const postReposts = await prisma.reposts.findMany({
        orderBy: {
          allRepostsCounter: 'desc'
        },
        where: {
          targetKey: post.postKey,
          repostBlockHeight: {
            not: 0
          }
        }
      });
      const numberOfReposts = postReposts.length;
      const numberOfRepostsWitness = targetsRepostsCountersMap.getWitness(postKey).toJSON();
      const embeddedReposts: EmbeddedReposts[] = [];

      for (const repost of postReposts) {
        const reposterAddress = PublicKey.fromBase58(repost.reposterAddress);
        const repostKey = Field(repost.repostKey);
        const repostWitness = repostsMap.getWitness(repostKey).toJSON();

        const repostState = new RepostState({
          isTargetPost: Bool(repost.isTargetPost),
          targetKey: postKey,
          reposterAddress: reposterAddress,
          allRepostsCounter: Field(repost.allRepostsCounter),
          userRepostsCounter: Field(repost.userRepostsCounter),
          targetRepostsCounter: Field(repost.targetRepostsCounter),
          repostBlockHeight: Field(repost.repostBlockHeight),
          deletionBlockHeight: Field(repost.deletionBlockHeight),
          restorationBlockHeight: Field(repost.restorationBlockHeight)
        });

        embeddedReposts.push({
          repostState: JSON.stringify(repostState),
          repostWitness: JSON.stringify(repostWitness)
        })
      }

      const currentUserRepost = await prisma.reposts.findMany({
        orderBy: {
          allRepostsCounter: 'desc'
        },
        where: {
          targetKey: post.postKey,
          reposterAddress: currentUser,
          repostBlockHeight: {
            not: 0
          },
          deletionBlockHeight: 0
        }
      });

      let currentUserRepostStateResponse: string | undefined;
      let currentUserRepostKeyResponse: string | undefined;
      let currentUserRepostWitnessResponse: string | undefined;
      if (currentUserRepost.length === 1) {
        const currentUserReposterAddress = PublicKey.fromBase58(currentUserRepost[0].reposterAddress);
        const currentUserRepostKey = Field(currentUserRepost[0].repostKey);
        const currentUserRepostWitness = repostsMap.getWitness(currentUserRepostKey).toJSON();
  
        const currentUserRepostState = new RepostState({
          isTargetPost: Bool(currentUserRepost[0].isTargetPost),
          targetKey: postKey,
          reposterAddress: currentUserReposterAddress,
          allRepostsCounter: Field(currentUserRepost[0].allRepostsCounter),
          userRepostsCounter: Field(currentUserRepost[0].userRepostsCounter),
          targetRepostsCounter: Field(currentUserRepost[0].targetRepostsCounter),
          repostBlockHeight: Field(currentUserRepost[0].repostBlockHeight),
          deletionBlockHeight: Field(currentUserRepost[0].deletionBlockHeight),
          restorationBlockHeight: Field(currentUserRepost[0].restorationBlockHeight)
        });

        currentUserRepostStateResponse = JSON.stringify(currentUserRepostState);
        currentUserRepostKeyResponse = currentUserRepost[0].repostKey;
        currentUserRepostWitnessResponse = JSON.stringify(currentUserRepostWitness);
      }

      postsResponse.push({
        postState: JSON.stringify(postState),
        postKey: post.postKey,
        postContentID: post.postContentID,
        content: content,
        postWitness: JSON.stringify(postWitness),
        embeddedReactions: embeddedReactions,
        numberOfReactions: numberOfReactions,
        numberOfReactionsWitness: JSON.stringify(numberOfReactionsWitness),
        embeddedComments: embeddedComments,
        numberOfComments: numberOfComments,
        numberOfCommentsWitness: JSON.stringify(numberOfCommentsWitness),
        embeddedReposts: embeddedReposts,
        numberOfReposts: numberOfReposts,
        numberOfRepostsWitness: JSON.stringify(numberOfRepostsWitness),
        currentUserRepostState: currentUserRepostStateResponse,
        currentUserRepostKey: currentUserRepostKeyResponse,
        currentUserRepostWitness: currentUserRepostWitnessResponse,
      });
    };

    const lastPostsState = await getLastPostsState(prisma);

    if (lastPostsState === null) {
      return {
        postsAuditMetadata: {},
        postsResponse: postsResponse
      }
    }

    const lastReactionsState = await getLastReactionsState(prisma);

    let lastReactionsStateResponse;
    if (lastReactionsState === null) {
      lastReactionsStateResponse = {
        allReactionsCounter: '0',
        usersReactionsCounters: '',
        targetsReactionsCounters: '',
        reactions: '',
        hashedState: '',
        atBlockHeight: '0',
        status: null
      }
    } else {
      lastReactionsStateResponse = {
        allReactionsCounter: lastReactionsState.allReactionsCounter.toString(),
        usersReactionsCounters: lastReactionsState.usersReactionsCounters,
        targetsReactionsCounters: lastReactionsState.targetsReactionsCounters,
        reactions: lastReactionsState.reactions,
        hashedState: lastReactionsState.hashedState,
        atBlockHeight: lastReactionsState.atBlockHeight.toString(),
        status: null
      }
    }

    const lastCommentsState = await getLastCommentsState(prisma);

    let lastCommentsStateResponse;
    if (lastCommentsState === null) {
      lastCommentsStateResponse = {
        allCommentsCounter: '0',
        usersCommentsCounters: '',
        targetsCommentsCounters: '',
        comments: '',
        hashedState: '',
        atBlockHeight: '0',
        status: null
      }
    } else {
      lastCommentsStateResponse = {
        allCommentsCounter: lastCommentsState.allCommentsCounter.toString(),
        usersCommentsCounters: lastCommentsState.usersCommentsCounters,
        targetsCommentsCounters: lastCommentsState.targetsCommentsCounters,
        comments: lastCommentsState.comments,
        hashedState: lastCommentsState.hashedState,
        atBlockHeight: lastCommentsState.atBlockHeight.toString(),
        status: null
      }
    }

    const lastRepostsState = await getLastRepostsState(prisma);

    let lastRepostsStateResponse;
    if (lastRepostsState === null) {
      lastRepostsStateResponse = {
        allRepostsCounter: '0',
        usersRepostsCounters: '',
        targetsRepostsCounters: '',
        reposts: '',
        hashedState: '',
        atBlockHeight: '0',
        status: null
      }
    } else {
      lastRepostsStateResponse = {
        allRepostsCounter: lastRepostsState.allRepostsCounter.toString(),
        usersRepostsCounters: lastRepostsState.usersRepostsCounters,
        targetsRepostsCounters: lastRepostsState.targetsRepostsCounters,
        reposts: lastRepostsState.reposts,
        hashedState: lastRepostsState.hashedState,
        atBlockHeight: lastRepostsState.atBlockHeight.toString(),
        status: null
      }
    }

    let profileAddressForAudit;
    if (profileAddress) {
      const profileAddressAsPublicKey = PublicKey.fromBase58(profileAddress);
      profileAddressForAudit = Poseidon.hash(profileAddressAsPublicKey.toFields());
    } else {
      profileAddressForAudit = Field(0);
    }

    const hashedQuery = Poseidon.hash([
      Field(howMany),
      Field(fromBlock),
      Field(toBlock),
      profileAddressForAudit
    ]);

    const severSignature = Signature.create(
      serverKey,
      [
        hashedQuery,
        Field(lastPostsState.hashedState),
        Field(lastPostsState.atBlockHeight),
        Field(lastReactionsStateResponse.hashedState),
        Field(lastReactionsStateResponse.atBlockHeight),
        Field(lastCommentsStateResponse.hashedState),
        Field(lastCommentsStateResponse.atBlockHeight),
        Field(lastRepostsStateResponse.hashedState),
        Field(lastRepostsStateResponse.atBlockHeight)
      ]
    );

    const postsAuditMetadata = {
      query: {
        howMany,
        fromBlock,
        toBlock,
        profileAddressForAudit
      },
      hashedQuery: hashedQuery.toString(),
      allPostsCounter: lastPostsState.allPostsCounter.toString(),
      userPostsCounter: lastPostsState.userPostsCounter,
      posts: lastPostsState.posts,
      hashedState: lastPostsState.hashedState,
      atBlockHeight: lastPostsState.atBlockHeight.toString(),
      lastReactionsState: lastReactionsStateResponse,
      lastCommentsState: lastCommentsStateResponse,
      lastRepostsState: lastRepostsStateResponse,
      severSignature: JSON.stringify(severSignature)
    }

    const response = {
      auditMetadata: postsAuditMetadata,
      postsResponse: postsResponse
    }

    return response;
  } catch(e) {
      console.error(e);
  }
});

// ============================================================================

server.get<{Querystring: HistoricStateAudit}>('/posts/audit', async (request) => {
  try {
    const { atBlockHeight } = request.query

    const historicPostsState = await prisma.postsStateHistory.findUnique({
      where: {
        atBlockHeight: atBlockHeight
      }
    });

    const historicPostsStateWitness = postsStateHistoryMap.getWitness(
      Field(atBlockHeight)
    );

    const response = {
      historicPostsState: {
        allPostsCounter: historicPostsState!.allPostsCounter.toString(),
        userPostsCounter: historicPostsState!.userPostsCounter,
        posts: historicPostsState!.posts,
        hashedState: historicPostsState!.hashedState,
        atBlockHeight: historicPostsState!.atBlockHeight.toString()
      },
      historicPostsStateWitness: JSON.stringify(historicPostsStateWitness)
    }

    return response;

  } catch(e) {
      console.error(e);
  }
});

// ============================================================================

server.get<{Querystring: HistoricStateAudit}>('/reactions/audit', async (request) => {
  try {
    const { atBlockHeight } = request.query

    const historicReactionsState = await prisma.reactionsStateHistory.findUnique({
      where: {
        atBlockHeight: atBlockHeight
      }
    });

    const historicReactionsStateWitness = reactionsStateHistoryMap.getWitness(
      Field(atBlockHeight)
    );

    const response = {
      historicReactionsState: {
        allReactionsCounter: historicReactionsState!.allReactionsCounter.toString(),
        userReactionsCounter: historicReactionsState!.usersReactionsCounters,
        targetsReactionsCounters: historicReactionsState!.targetsReactionsCounters,
        reactions: historicReactionsState!.reactions,
        hashedState: historicReactionsState!.hashedState,
        atBlockHeight: historicReactionsState!.atBlockHeight.toString()
      },
      historicReactionsStateWitness: JSON.stringify(historicReactionsStateWitness)
    }

    return response;

  } catch(e) {
      console.error(e);
  }
});

// ============================================================================

server.get<{Querystring: HistoricStateAudit}>('/comments/audit', async (request) => {
  try {
    const { atBlockHeight } = request.query

    const historicCommentsState = await prisma.commentsStateHistory.findUnique({
      where: {
        atBlockHeight: atBlockHeight
      }
    });

    const historicCommentsStateWitness = commentsStateHistoryMap.getWitness(
      Field(atBlockHeight)
    );

    const response = {
      historicCommentsState: {
        allCommentsCounter: historicCommentsState!.allCommentsCounter.toString(),
        userCommentsCounter: historicCommentsState!.usersCommentsCounters,
        targetsCommentsCounters: historicCommentsState!.targetsCommentsCounters,
        comments: historicCommentsState!.comments,
        hashedState: historicCommentsState!.hashedState,
        atBlockHeight: historicCommentsState!.atBlockHeight.toString()
      },
      historicCommentsStateWitness: JSON.stringify(historicCommentsStateWitness)
    }

    return response;

  } catch(e) {
      console.error(e);
  }
});

// ============================================================================

server.get<{Querystring: CommentsQuery}>('/comments', async (request) => {
  try {
    const { targetKey, howMany, fromBlock, toBlock, commentKey } = request.query;

    if (commentKey !== undefined) {
      const comment = await prisma.comments.findUnique({
        where: {
          commentKey: commentKey
        }
      });

      const commenterAddress = PublicKey.fromBase58(comment!.commenterAddress);
      const commentContentID = CircuitString.fromString(comment!.commentContentID);

      const commentState = new CommentState({
        isTargetPost: Bool(comment!.isTargetPost),
        targetKey: Field(comment!.targetKey),
        commenterAddress: commenterAddress,
        commentContentID: commentContentID,
        allCommentsCounter: Field(comment!.allCommentsCounter),
        userCommentsCounter: Field(comment!.userCommentsCounter),
        commentBlockHeight: Field(comment!.commentBlockHeight),
        targetCommentsCounter: Field(comment!.targetCommentsCounter),
        deletionBlockHeight: Field(comment!.deletionBlockHeight),
        restorationBlockHeight: Field(comment!.restorationBlockHeight)
      });
      return { commentState: JSON.stringify(commentState)};
    }

    const lastComments = (await prisma.comments.findMany({
      take: Number(howMany),
      orderBy: {
        targetCommentsCounter: 'desc'
      },
      where: {
        targetKey: targetKey,
        commentBlockHeight: {
          not: 0,
          gte: fromBlock,
          lte: toBlock
        },
        deletionBlockHeight: {
          not: 0
        }
      }
    }));

    let numberOfDeletedComments = lastComments.filter(comment => comment.deletionBlockHeight !== 0n).length;

    const comments = await prisma.comments.findMany({
      take: Number(howMany) + numberOfDeletedComments,
      orderBy: {
        targetCommentsCounter: 'desc'
      },
      where: {
        targetKey: targetKey,
        commentBlockHeight: {
          not: 0,
          gte: fromBlock,
          lte: toBlock
        }
      }
    });

    const commentsResponse: CommentsResponse[] = [];

    for (const comment of comments) {
      const commenterAddress = PublicKey.fromBase58(comment.commenterAddress);
      const commentContentID = CircuitString.fromString(comment.commentContentID);
      const commentKey = Field(comment.commentKey);
      const commentWitness = commentsMap.getWitness(commentKey).toJSON();

      let content = '';
      if (comment.deletionBlockHeight === BigInt(0)) {
        content = await fs.readFile('./comments/' + comment.commentContentID, 'utf8');
      }

      const commentState = new CommentState({
        isTargetPost: Bool(comment.isTargetPost),
        targetKey: Field(comment.targetKey),
        commenterAddress: commenterAddress,
        commentContentID: commentContentID,
        allCommentsCounter: Field(comment.allCommentsCounter),
        userCommentsCounter: Field(comment.userCommentsCounter),
        commentBlockHeight: Field(comment.commentBlockHeight),
        targetCommentsCounter: Field(comment.targetCommentsCounter),
        deletionBlockHeight: Field(comment.deletionBlockHeight),
        restorationBlockHeight: Field(comment.restorationBlockHeight)
      });

      commentsResponse.push({
        commentState: JSON.stringify(commentState),
        commentKey: comment.commentKey,
        commentContentID: comment.commentContentID,
        content: content,
        commentWitness: JSON.stringify(commentWitness),
      });
    };

    const lastCommentsState = await getLastCommentsState(prisma);

    let lastCommentsStateResponse;
    if (lastCommentsState === null) {
      lastCommentsStateResponse = {
        allCommentsCounter: '0',
        usersCommentsCounters: '',
        targetsCommentsCounters: '',
        comments: '',
        hashedState: '',
        atBlockHeight: '0',
        status: null
      }
    } else {
      lastCommentsStateResponse = {
        allCommentsCounter: lastCommentsState.allCommentsCounter.toString(),
        usersCommentsCounters: lastCommentsState.usersCommentsCounters,
        targetsCommentsCounters: lastCommentsState.targetsCommentsCounters,
        comments: lastCommentsState.comments,
        hashedState: lastCommentsState.hashedState,
        atBlockHeight: lastCommentsState.atBlockHeight.toString(),
        status: null
      }
    }

    const hashedQuery = Poseidon.hash([
      Field(howMany),
      Field(fromBlock),
      Field(toBlock)
    ]);

    const severSignature = Signature.create(
      serverKey,
      [
        hashedQuery,
        Field(lastCommentsStateResponse.hashedState),
        Field(lastCommentsStateResponse.atBlockHeight)
      ]
    );

    const commentsAuditMetadata = {
      query: {
        howMany,
        fromBlock,
        toBlock
      },
      hashedQuery: hashedQuery.toString(),
      lastCommentsState: lastCommentsStateResponse,
      severSignature: JSON.stringify(severSignature)
    }

    const response = {
      auditMetadata: commentsAuditMetadata,
      commentsResponse: commentsResponse
    }

    return response;

  } catch (e) {
    console.log(e)
  }
});

// ============================================================================

server.get<{Querystring: RepostQuery}>('/reposts', async (request) => {
  try {
    const { howMany, fromBlock, toBlock, profileAddress, repostKey } = request.query;

    if (repostKey !== undefined) {
      const repost = await prisma.reposts.findUnique({
        where: {
          repostKey: repostKey
        }
      });

      const reposterAddress = PublicKey.fromBase58(repost!.reposterAddress);

      const repostState = new RepostState({
        isTargetPost: Bool(repost!.isTargetPost),
        targetKey: Field(repost!.targetKey),
        reposterAddress: reposterAddress,
        allRepostsCounter: Field(repost!.allRepostsCounter),
        userRepostsCounter: Field(repost!.userRepostsCounter),
        repostBlockHeight: Field(repost!.repostBlockHeight),
        targetRepostsCounter: Field(repost!.targetRepostsCounter),
        deletionBlockHeight: Field(repost!.deletionBlockHeight),
        restorationBlockHeight: Field(repost!.restorationBlockHeight)
      });
      return { repostState: JSON.stringify(repostState)};
    }

    let numberOfDeletedReposts: number;
    let reposts: Prisma.PromiseReturnType<typeof prisma.reposts.findMany>;

    if (profileAddress === undefined) {

      numberOfDeletedReposts = (await prisma.reposts.findMany({
        take: Number(howMany),
        orderBy: {
          allRepostsCounter: 'desc'
        },
        where: {
          repostBlockHeight: {
            not: 0,
            gte: fromBlock,
            lte: toBlock
          },
          deletionBlockHeight: {
            not: 0
          }
        }
      })).length;

      reposts = await prisma.reposts.findMany({
        take: Number(howMany) + numberOfDeletedReposts,
        orderBy: {
          allRepostsCounter: 'desc'
        },
        where: {
          repostBlockHeight: {
            not: 0,
            gte: fromBlock,
            lte: toBlock
          }
        }
      });

    } else {

      reposts = await prisma.reposts.findMany({
        take: Number(howMany),
        orderBy: {
          allRepostsCounter: 'desc'
        },
        where: {
          reposterAddress: profileAddress,
          repostBlockHeight: {
            not: 0,
            gte: fromBlock,
            lte: toBlock
          }
        }
      });

    }

    const repostsResponse: RepostsResponse[] = [];

    for (const repost of reposts ) {
      const targetKey = Field(repost.targetKey);
      const reposterAddress = PublicKey.fromBase58(repost.reposterAddress);
      const repostKey = Field(repost.repostKey);
      const repostWitness = repostsMap.getWitness(repostKey).toJSON();

      const repostState = new RepostState({
        isTargetPost: Bool(repost.isTargetPost),
        targetKey: targetKey,
        reposterAddress: reposterAddress,
        allRepostsCounter: Field(repost.allRepostsCounter),
        userRepostsCounter: Field(repost.userRepostsCounter),
        targetRepostsCounter: Field(repost.targetRepostsCounter),
        repostBlockHeight: Field(repost.repostBlockHeight),
        deletionBlockHeight: Field(repost.deletionBlockHeight),
        restorationBlockHeight: Field(repost.restorationBlockHeight)
      });

      const post = await prisma.posts.findUnique({
        where: {
          postKey: repost.targetKey
        }
      });

      const posterAddress = PublicKey.fromBase58(post!.posterAddress);
      const postContentID = CircuitString.fromString(post!.postContentID);
      const postKey = Field(post!.postKey);
      const postWitness = postsMap.getWitness(postKey).toJSON();

      let content = '';
      if (post!.deletionBlockHeight === BigInt(0)) {
        content = await fs.readFile('./posts/' + post!.postContentID, 'utf8');
      }

      const postState = new PostState({
        posterAddress: posterAddress,
        postContentID: postContentID,
        allPostsCounter: Field(post!.allPostsCounter),
        userPostsCounter: Field(post!.userPostsCounter),
        postBlockHeight: Field(post!.postBlockHeight),
        deletionBlockHeight: Field(post!.deletionBlockHeight),
        restorationBlockHeight: Field(post!.restorationBlockHeight)
      });

      const postReactions = await prisma.reactions.findMany({
        orderBy: {
          allReactionsCounter: 'desc'
        },
        where: {
          targetKey: post?.postKey,
          reactionBlockHeight: {
            not: 0
          }
        }
      });
      const numberOfReactions = postReactions.length;
      const numberOfReactionsWitness = targetsReactionsCountersMap.getWitness(postKey).toJSON();

      const embeddedReactions: EmbeddedReactions[] = [];

      for (const reaction of postReactions) {
        const reactorAddress = PublicKey.fromBase58(reaction.reactorAddress);
        const reactionCodePointAsField = Field(reaction.reactionCodePoint);
        const reactionKey = Field(reaction.reactionKey);
        const reactionWitness = reactionsMap.getWitness(reactionKey).toJSON();

        const reactionState = new ReactionState({
          isTargetPost: Bool(reaction.isTargetPost),
          targetKey: postKey,
          reactorAddress: reactorAddress,
          reactionCodePoint: reactionCodePointAsField,
          allReactionsCounter: Field(reaction.allReactionsCounter),
          userReactionsCounter: Field(reaction.userReactionsCounter),
          targetReactionsCounter: Field(reaction.targetReactionsCounter),
          reactionBlockHeight: Field(reaction.reactionBlockHeight),
          deletionBlockHeight: Field(reaction.deletionBlockHeight),
          restorationBlockHeight: Field(reaction.restorationBlockHeight)
        });

        embeddedReactions.push({
          reactionState: JSON.stringify(reactionState),
          reactionWitness: JSON.stringify(reactionWitness)
        })
      }

      const postComments = await prisma.comments.findMany({
        orderBy: {
          allCommentsCounter: 'desc'
        },
        where: {
          targetKey: post!.postKey,
          commentBlockHeight: {
            not: 0
          }
        }
      });
      const numberOfComments = postComments.length;
      const numberOfCommentsWitness = targetsCommentsCountersMap.getWitness(postKey).toJSON();
            const embeddedComments: EmbeddedComments[] = [];

      for (const comment of postComments) {
        const commenterAddress = PublicKey.fromBase58(comment.commenterAddress);
        const commentContentID = CircuitString.fromString(comment.commentContentID);
        const commentKey = Field(comment.commentKey);
        const commentWitness = commentsMap.getWitness(commentKey).toJSON();

        const commentState = new CommentState({
          isTargetPost: Bool(comment.isTargetPost),
          targetKey: postKey,
          commenterAddress: commenterAddress,
          commentContentID: commentContentID,
          allCommentsCounter: Field(comment.allCommentsCounter),
          userCommentsCounter: Field(comment.userCommentsCounter),
          targetCommentsCounter: Field(comment.targetCommentsCounter),
          commentBlockHeight: Field(comment.commentBlockHeight),
          deletionBlockHeight: Field(comment.deletionBlockHeight),
          restorationBlockHeight: Field(comment.restorationBlockHeight)
        });

        embeddedComments.push({
          commentState: JSON.stringify(commentState),
          commentWitness: JSON.stringify(commentWitness)
        })
      }

      const postReposts = await prisma.reposts.findMany({
        orderBy: {
          allRepostsCounter: 'desc'
        },
        where: {
          targetKey: post!.postKey,
          repostBlockHeight: {
            not: 0
          }
        }
      });
      const numberOfReposts = postReposts.length;
      const numberOfRepostsWitness = targetsRepostsCountersMap.getWitness(postKey).toJSON();
            const embeddedReposts: EmbeddedReposts[] = [];

      for (const repost of postReposts) {
        const reposterAddress = PublicKey.fromBase58(repost.reposterAddress);
        const repostKey = Field(repost.repostKey);
        const repostWitness = repostsMap.getWitness(repostKey).toJSON();

        const repostState = new RepostState({
          isTargetPost: Bool(repost.isTargetPost),
          targetKey: postKey,
          reposterAddress: reposterAddress,
          allRepostsCounter: Field(repost.allRepostsCounter),
          userRepostsCounter: Field(repost.userRepostsCounter),
          targetRepostsCounter: Field(repost.targetRepostsCounter),
          repostBlockHeight: Field(repost.repostBlockHeight),
          deletionBlockHeight: Field(repost.deletionBlockHeight),
          restorationBlockHeight: Field(repost.restorationBlockHeight)
        });

        embeddedReposts.push({
          repostState: JSON.stringify(repostState),
          repostWitness: JSON.stringify(repostWitness)
        })
      }

      repostsResponse.push({
        repostState: JSON.stringify(repostState),
        repostKey: repost.repostKey,
        repostWitness: JSON.stringify(repostWitness),
        postState: JSON.stringify(postState),
        postKey: post!.postKey,
        postContentID: post!.postContentID,
        content: content,
        postWitness: JSON.stringify(postWitness),
        embeddedReactions: embeddedReactions,
        numberOfReactions: numberOfReactions,
        numberOfReactionsWitness: JSON.stringify(numberOfReactionsWitness),
        embeddedComments: embeddedComments,
        numberOfComments: numberOfComments,
        numberOfCommentsWitness: JSON.stringify(numberOfCommentsWitness),
        embeddedReposts: embeddedReposts,
        numberOfReposts: numberOfReposts,
        numberOfRepostsWitness: JSON.stringify(numberOfRepostsWitness)
      })
    }

    const response = {
      repostsResponse: repostsResponse
    }

    return response;

  } catch(e) {
      console.error(e);
  }
});

// ============================================================================

server.get<{Querystring: ReactionQuery}>('/reactions', async (request) => {
  try {

    const { reactionKey } = request.query;
    const reaction = await prisma.reactions.findUnique({
      where: {
        reactionKey: reactionKey
      }
    });

    const reactorAddress = PublicKey.fromBase58(reaction!.reactorAddress);

    const reactionState = new ReactionState({
      isTargetPost: Bool(reaction!.isTargetPost),
      targetKey: Field(reaction!.targetKey),
      reactorAddress: reactorAddress,
      reactionCodePoint: Field(reaction!.reactionCodePoint),
      allReactionsCounter: Field(reaction!.allReactionsCounter),
      userReactionsCounter: Field(reaction!.userReactionsCounter),
      reactionBlockHeight: Field(reaction!.reactionBlockHeight),
      targetReactionsCounter: Field(reaction!.targetReactionsCounter),
      deletionBlockHeight: Field(reaction!.deletionBlockHeight),
      restorationBlockHeight: Field(reaction!.restorationBlockHeight)
    });

    return { reactionState: JSON.stringify(reactionState)};

  } catch(e) {
    console.error(e);
  }
});

// ============================================================================

interface SignedData {
  signature: string,
  publicKey: string,
  data: string[]
}

interface SignedPost {
  post: string,
  signedData: SignedData
}

interface SignedComment {
  comment: string,
  signedData: SignedData
}

interface PostsQuery {
  howMany: number,
  fromBlock: number,
  toBlock: number,
  profileAddress: string,
  postKey: string,
  currentUser: string
}

interface HistoricStateAudit {
  atBlockHeight: number
}

// ============================================================================

interface RepostQuery {
  howMany: number,
  fromBlock: number,
  toBlock: number,
  profileAddress: string,
  repostKey: string
}

interface CommentsQuery {
  targetKey: string,
  howMany: number,
  fromBlock: number,
  toBlock: number,
  commentKey: string
}

interface ReactionQuery {
  reactionKey: string
}

// ============================================================================

interface SignedPostDeletion {
  postKey: string,
  signedData: SignedData
}

interface SignedCommentDeletion {
  targetKey: string,
  commentKey: string,
  signedData: SignedData
}

interface SignedReactionDeletion {
  reactionState: string,
  signedData: SignedData
}

interface SignedRepostDeletion {
  targetKey: string,
  repostKey: string,
  signedData: SignedData
}

// ============================================================================

interface SignedPostRestoration {
  postKey: string,
  signedData: SignedData
}

interface SignedCommentRestoration {
  targetKey: string,
  commentKey: string,
  signedData: SignedData
}

interface SignedRepostRestoration {
  targetKey: string,
  repostKey: string,
  signedData: SignedData
}

interface SignedReactionRestoration {
  targetKey: string,
  reactionKey: string,
  signedData: SignedData
}

// ============================================================================

type EmbeddedReactions = {
  reactionState: string,
  reactionWitness: string
}

type EmbeddedComments = {
  commentState: string,
  commentWitness: string
}

type EmbeddedReposts = {
  repostState: string,
  repostWitness: string
}

// ============================================================================

type PostsResponse = {
  postState: string,
  postKey: string,
  postContentID: string,
  content: string,
  postWitness: string,
  embeddedReactions: EmbeddedReactions[],
  numberOfReactions: number,
  numberOfReactionsWitness: string,
  embeddedComments: EmbeddedComments[],
  numberOfComments: number,
  numberOfCommentsWitness: string,
  embeddedReposts: EmbeddedReposts[],
  numberOfReposts: number,
  numberOfRepostsWitness: string,
  currentUserRepostState: string | undefined,
  currentUserRepostKey: string | undefined,
  currentUserRepostWitness: string | undefined
}

type CommentsResponse = {
  commentState: string,
  commentKey: string,
  commentContentID: string,
  content: string,
  commentWitness: string,
}

type RepostsResponse = {
  repostState: string,
  repostKey: string,
  repostWitness: string,
  postState: string,
  postKey: string,
  postContentID: string,
  content: string,
  postWitness: string,
  embeddedReactions: EmbeddedReactions[],
  numberOfReactions: number,
  numberOfReactionsWitness: string,
  embeddedComments: EmbeddedComments[],
  numberOfComments: number,
  numberOfCommentsWitness: string,
  embeddedReposts: EmbeddedReposts[],
  numberOfReposts: number,
  numberOfRepostsWitness: string
}

// ============================================================================

const getCID = async (file: Blob) => {
  let postCID: any;
  await createFileEncoderStream(file)
  .pipeThrough(
  new TransformStream({
      transform(block, controller) {
      postCID = block.cid;
      controller.enqueue(block);
      },
  })
  )
  .pipeThrough(new CAREncoderStream())
  .pipeTo(new WritableStream());

  return postCID;
}

// ============================================================================

const createSQLPost = async (postKey: Field,
  signature: Signature,
  posterAddress: PublicKey,
  allPostsCounter: number,
  userPostsCounter: number,
  postCID: any
) => {

  await prisma.posts.create({
    data: {
      postKey: postKey.toString(),
      posterAddress: posterAddress.toBase58(),
      postContentID: postCID.toString(),
      allPostsCounter: allPostsCounter,
      userPostsCounter: userPostsCounter,
      postBlockHeight: 0,
      deletionBlockHeight: 0,
      restorationBlockHeight: 0,
      status: 'create',
      pendingSignature: signature.toBase58()
    }
  });
}

// ============================================================================

const createSQLReaction = async (
  reactionKey: Field,
  targetKey: Field,
  reactorAddress: string,
  reactionCodePoint: number,
  allReactionsCounter: number,
  userReactionsCounter: number,
  targetReactionsCounter:number,
  signature: string
) => {

  await prisma.reactions.create({
    data: {
      reactionKey: reactionKey.toString(),
      isTargetPost: true,
      targetKey: targetKey.toString(),
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePoint,
      allReactionsCounter: allReactionsCounter,
      userReactionsCounter: userReactionsCounter,
      targetReactionsCounter: targetReactionsCounter,
      reactionBlockHeight: 0,
      deletionBlockHeight: 0,
      restorationBlockHeight: 0,
      status: 'create',
      pendingSignature: signature
    }
  });
}

// ============================================================================

const createSQLComment = async (
  commentKey: Field,
  targetKey: Field,
  commenterAddress: string,
  commentCID: any,
  allCommentsCounter: number,
  userCommentsCounter: number,
  targetCommentsCounter: number,
  signature: string
) => {

  await prisma.comments.create({
    data: {
      commentKey: commentKey.toString(),
      isTargetPost: false,
      targetKey: targetKey.toString(),
      commenterAddress: commenterAddress,
      commentContentID: commentCID.toString(),
      allCommentsCounter: allCommentsCounter,
      userCommentsCounter: userCommentsCounter,
      targetCommentsCounter: targetCommentsCounter,
      commentBlockHeight: 0,
      deletionBlockHeight: 0,
      restorationBlockHeight: 0,
      status: 'create',
      pendingSignature: signature
    }
  });
}

// ============================================================================

const createSQLRepost = async (
  repostKey: Field,
  targetKey: Field,
  reposterAddress: string,
  allRepostsCounter: number,
  userRepostsCounter: number,
  targetRepostsCounter:number,
  signature: string
) => {

  await prisma.reposts.create({
    data: {
      repostKey: repostKey.toString(),
      isTargetPost: true,
      targetKey: targetKey.toString(),
      reposterAddress: reposterAddress,
      allRepostsCounter: allRepostsCounter,
      userRepostsCounter: userRepostsCounter,
      targetRepostsCounter: targetRepostsCounter,
      repostBlockHeight: 0,
      deletionBlockHeight: 0,
      restorationBlockHeight: 0,
      status: 'create',
      pendingSignature: signature
    }
  });
}

// ============================================================================