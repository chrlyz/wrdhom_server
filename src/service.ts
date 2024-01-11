import fastify from 'fastify';
import { CircuitString, PublicKey, Signature, Field, MerkleMap, Poseidon, Bool, MerkleMapWitness } from 'o1js';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { createFileEncoderStream, CAREncoderStream } from 'ipfs-car';
import { Blob } from '@web-std/file';
import { create } from '@web3-storage/w3up-client';
import * as dotenv from 'dotenv';
import { regeneratePostsZkAppState, regenerateReactionsZkAppState,
  regenerateCommentsZkAppState, regenerateRepostsZkAppState
} from './utils/state.js';
import { CommentState, PostState, ReactionState, fieldToFlagTargetAsReposted,
  RepostState
} from 'wrdhom';
import fs from 'fs/promises';
import { fastifySchedule } from '@fastify/schedule';
import { SimpleIntervalJob, AsyncTask } from 'toad-scheduler';

// ============================================================================

// Load .env

dotenv.config();

// Set up client for PostgreSQL for structured data

const prisma = new PrismaClient();

// Set up client for IPFS for unstructured data

const web3storage = await create();
console.log('Logging-in to web3.storage...');
await web3storage.login(process.env.W3S_EMAIL as `${string}@${string}`);
await web3storage.setCurrentSpace(process.env.W3S_SPACE as `did:${string}:${string}`);

// ============================================================================

// Regenerate Merkle maps from database

const usersPostsCountersMap = new MerkleMap();
const postsMap = new MerkleMap();
let numberOfPosts = 0;

const postsContext = {
  prisma: prisma,
  usersPostsCountersMap: usersPostsCountersMap,
  postsMap: postsMap,
  numberOfPosts: numberOfPosts
}

const posts = await regeneratePostsZkAppState(postsContext);

const usersReactionsCountersMap = new MerkleMap();
const targetsReactionsCountersMap =  new MerkleMap();
const reactionsMap = new MerkleMap();
let numberOfReactions = 0;

const reactionsContext = {
  prisma: prisma,
  usersReactionsCountersMap: usersReactionsCountersMap,
  targetsReactionsCountersMap: targetsReactionsCountersMap,
  reactionsMap: reactionsMap,
  numberOfReactions: numberOfReactions
}

await regenerateReactionsZkAppState(reactionsContext);

const usersCommentsCountersMap = new MerkleMap();
const targetsCommentsCountersMap =  new MerkleMap();
const commentsMap = new MerkleMap();
let numberOfComments = 0;

const commentsContext = {
  prisma: prisma,
  usersCommentsCountersMap: usersCommentsCountersMap,
  targetsCommentsCountersMap: targetsCommentsCountersMap,
  commentsMap: commentsMap,
  numberOfComments: numberOfComments
}

const comments = await regenerateCommentsZkAppState(commentsContext);

const usersRepostsCountersMap = new MerkleMap();
const targetsRepostsCountersMap =  new MerkleMap();
const repostsMap = new MerkleMap();
let numberOfReposts = 0;

const repostsContext = {
  prisma: prisma,
  usersRepostsCountersMap: usersRepostsCountersMap,
  targetsRepostsCountersMap: targetsRepostsCountersMap,
  repostsMap: repostsMap,
  numberOfReposts: numberOfReposts
}

await regenerateRepostsZkAppState(repostsContext);

// Get content and keep it locally for faster reponses

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

for (const post of posts) {
  try {
    await fs.readFile('./posts/' + post.postContentID, 'utf8');
  } catch (e: any) {
      if (e.code === 'ENOENT') {
        const contentResponse = await fetch('https://' + post.postContentID + '.ipfs.w3s.link');
        const content = await contentResponse.text();
        await fs.writeFile('./posts/' + post.postContentID, content, 'utf-8');
      } else {
          console.error(e);
      }
  }
};

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

for (const comment of comments) {
  try {
    await fs.readFile('./comments/' + comment.commentContentID, 'utf8');
  } catch (e: any) {
      if (e.code === 'ENOENT') {
        const commentsContentResponse = await fetch('https://' + comment.commentContentID + '.ipfs.w3s.link');
        const commentsContent = await commentsContentResponse.text();
        await fs.writeFile('./comments/' + comment.commentContentID, commentsContent, 'utf-8');
      } else {
          console.error(e);
      }
  }
};

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
    const pendingPosts = await prisma.posts.findMany({
      orderBy: {
        allPostsCounter: 'asc'
      },
      where: {
        allPostsCounter: {
          gt: postsContext.numberOfPosts
        },
        postBlockHeight: {
          not: 0
        }
      }
    });
    for (const pPost of pendingPosts) {
      const postContentResponse = await fetch('https://' + pPost.postContentID + '.ipfs.w3s.link');
      const postContent = await postContentResponse.text();
      await fs.writeFile('./posts/' + pPost.postContentID, postContent, 'utf-8');
      console.log(pPost);
      const postState = new PostState({
        posterAddress: PublicKey.fromBase58(pPost.posterAddress),
        postContentID: CircuitString.fromString(pPost.postContentID),
        allPostsCounter: Field(pPost.allPostsCounter),
        userPostsCounter: Field(pPost.userPostsCounter),
        postBlockHeight: Field(pPost.postBlockHeight),
        deletionBlockHeight: Field(pPost.deletionBlockHeight),
        restorationBlockHeight: Field(pPost.restorationBlockHeight)
      });

      const postKey = Field(pPost.postKey);
      postsMap.set(postKey, postState.hash());
      postsContext.numberOfPosts += 1;
    }

    const pendingReactions = await prisma.reactions.findMany({
      orderBy: {
        allReactionsCounter: 'asc'
      },
      where: {
        allReactionsCounter: {
          gt: reactionsContext.numberOfReactions
        },
        reactionBlockHeight: {
          not: 0
        }
      }
    });
    for (const pReaction of pendingReactions) {
      const reactorAddress = PublicKey.fromBase58(pReaction.reactorAddress);
      const reactionCodePointAsField = Field(pReaction.reactionCodePoint);
      
      console.log(pReaction);
      const reactionState = new ReactionState({
        isTargetPost: Bool(pReaction.isTargetPost),
        targetKey: Field(pReaction.targetKey),
        reactorAddress: reactorAddress,
        reactionCodePoint: reactionCodePointAsField,
        allReactionsCounter: Field(pReaction.allReactionsCounter),
        userReactionsCounter: Field(pReaction.userReactionsCounter),
        targetReactionsCounter: Field(pReaction.targetReactionsCounter),
        reactionBlockHeight: Field(pReaction.reactionBlockHeight),
        deletionBlockHeight: Field(pReaction.deletionBlockHeight),
        restorationBlockHeight: Field(pReaction.restorationBlockHeight)
      });

      const reactionKey = Field(pReaction.reactionKey);
      reactionsMap.set(reactionKey, reactionState.hash());
      reactionsContext.numberOfReactions += 1;
    }

    const pendingComments = await prisma.comments.findMany({
      orderBy: {
        allCommentsCounter: 'asc'
      },
      where: {
        allCommentsCounter: {
          gt: reactionsContext.numberOfReactions
        },
        commentBlockHeight: {
          not: 0
        }
      }
    });
    for (const pComment of pendingComments) {
      const commentContentResponse = await fetch('https://' + pComment.commentContentID + '.ipfs.w3s.link');
      const commentContent = await commentContentResponse.text();
      await fs.writeFile('./comments/' + pComment.commentContentID, commentContent, 'utf-8');
      const commenterAddress = PublicKey.fromBase58(pComment.commenterAddress);
      const commentContentIDAsCS = CircuitString.fromString(pComment.commentContentID);
      
      console.log(pComment);
      const commentState = new CommentState({
        isTargetPost: Bool(pComment.isTargetPost),
        targetKey: Field(pComment.targetKey),
        commenterAddress: commenterAddress,
        commentContentID: commentContentIDAsCS,
        allCommentsCounter: Field(pComment.allCommentsCounter),
        userCommentsCounter: Field(pComment.userCommentsCounter),
        targetCommentsCounter: Field(pComment.targetCommentsCounter),
        commentBlockHeight: Field(pComment.commentBlockHeight),
        deletionBlockHeight: Field(pComment.deletionBlockHeight),
        restorationBlockHeight: Field(pComment.restorationBlockHeight)
      });

      const reactionKey = Field(pComment.commentKey);
      commentsMap.set(reactionKey, commentState.hash());
      commentsContext.numberOfComments += 1;
    }

    const pendingReposts = await prisma.reposts.findMany({
      orderBy: {
        allRepostsCounter: 'asc'
      },
      where: {
        allRepostsCounter: {
          gt: repostsContext.numberOfReposts
        },
        repostBlockHeight: {
          not: 0
        }
      }
    });
    for (const pRepost of pendingReposts) {
      const reposterAddress = PublicKey.fromBase58(pRepost.reposterAddress);
      
      console.log(pRepost);
      const repostState = new RepostState({
        isTargetPost: Bool(pRepost.isTargetPost),
        targetKey: Field(pRepost.targetKey),
        reposterAddress: reposterAddress,
        allRepostsCounter: Field(pRepost.allRepostsCounter),
        userRepostsCounter: Field(pRepost.userRepostsCounter),
        targetRepostsCounter: Field(pRepost.targetRepostsCounter),
        repostBlockHeight: Field(pRepost.repostBlockHeight),
        deletionBlockHeight: Field(pRepost.deletionBlockHeight),
        restorationBlockHeight: Field(pRepost.restorationBlockHeight)
      });
    
      const repostKey = Field(pRepost.repostKey);
      repostsMap.set(repostKey, repostState.hash());
      repostsContext.numberOfReposts += 1;
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

  console.log(request.body.signedData);

  // Check that content and signed CID match
  const signature = Signature.fromBase58(request.body.signedData.signature);
  const posterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
  const postContentIDAsField = Field(request.body.signedData.data[0]);
  const postKey = Poseidon.hash([posterAddressAsField, postContentIDAsField]);
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

      await web3storage.uploadFile(file);
      await createSQLPost(postKey, signature, posterAddress, allPostsCounter, userPostsCounter, postCID);
      return request.body;
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
  const emojisCodePoints = ['❤️', '💔', '😂', '🤔', '😮', '😢', '😠', '😎',
    '🔥', '👀', '👍', '👎', '🙏', '🤝', '🤌', '🙌', '🤭',
    '😳', '😭', '🤯', '😡', '👽', '😈', '💀', '💯'
  ].map(emoji => emoji.codePointAt(0));
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

  if (post?.posterAddress === undefined) {
    return `The target you are trying to react to doesn't exist`;
  }

  // Check that content and signed CID match
  const signature = Signature.fromBase58(request.body.signedData.signature);
  const commenterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
  const posterAddressAsField = Poseidon.hash(PublicKey.fromBase58(post.posterAddress).toFields());
  const postContentIDAsField = CircuitString.fromString(post.postContentID).hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDAsField]);
  const commentContentIDAsField = Field(request.body.signedData.data[1]);
  const commentContentIDAsBigInt = commentContentIDAsField.toBigInt();
  const commentKey = Poseidon.hash([targetKey, commenterAddressAsField, commentContentIDAsField]);
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

      await web3storage.uploadFile(file);
      await createSQLComment(commentKey, targetKey, request.body.signedData.publicKey,
        commentCID, allCommentsCounter, userCommentsCounter, targetCommentsCounter,
        request.body.signedData.signature);
      return 'Valid Comment!';
    } else {
        return `Comment isn't signed`;
    }
  } else {
      return `Derived post CID, doesn't match signed comment CID`;
  }
});

// ============================================================================

server.post<{Body: SignedData}>('/reposts', async (request) => {
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
  const reposterAddress = PublicKey.fromBase58(request.body.publicKey);
  const targetKey = Field(request.body.data[0]);
  const isSigned = signature.verify(reposterAddress, [
    targetKey,
    fieldToFlagTargetAsReposted
  ]).toBoolean();
  const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());
  const repostKey = Poseidon.hash([targetKey, reposterAddressAsField]);

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
});

// ============================================================================

server.get<{Querystring: PostsQuery}>('/posts', async (request) => {
  try {
    const { howMany, fromBlock, toBlock, posterAddress } = request.query;
    let posts: {
      postKey: string;
      posterAddress: string;
      postContentID: string;
      allPostsCounter: bigint;
      userPostsCounter: bigint;
      postBlockHeight: bigint;
      deletionBlockHeight: bigint;
      restorationBlockHeight: bigint;
      postSignature: string;
    }[];

    if (posterAddress === undefined) {
      posts = await prisma.posts.findMany({
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
      });
    } else {
      posts = await prisma.posts.findMany({
        take: Number(howMany),
        orderBy: {
          allPostsCounter: 'desc'
        },
        where: {
          posterAddress: posterAddress,
          postBlockHeight: {
            not: 0,
            gte: fromBlock,
            lte: toBlock
          }
        }
      });
    }

    const postsResponse: {
      postState: string,
      postKey: string,
      postContentID: string,
      content: string,
      postWitness: JSON,
      reactionsResponse: {
        reactionState: string,
        reactionWitness: JSON
      }[],
      numberOfComments: number,
      numberOfReposts: number
    }[] = [];

    for (const post of posts) {
      const posterAddress = PublicKey.fromBase58(post.posterAddress);
      const postContentID = CircuitString.fromString(post.postContentID);
      const postKey = Field(post.postKey);
      const postWitness = postsMap.getWitness(postKey).toJSON();
      const content = await fs.readFile('./posts/' + post.postContentID, 'utf8');

      const postState = new PostState({
        posterAddress: posterAddress,
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
          targetKey: postKey.toString(),
          reactionBlockHeight: {
            not: 0
          }
        }
      });

      const reactionsResponse: {
        reactionState: string,
        reactionWitness: JSON
      }[] = [];

      for (const reaction of postReactions) {
        const reactorAddress = PublicKey.fromBase58(reaction.reactorAddress);
        const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
        const reactionCodePointAsField = Field(reaction.reactionCodePoint);
        const reactionKey = Poseidon.hash([postKey, reactorAddressAsField, reactionCodePointAsField]);
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

        reactionsResponse.push({
          reactionState: JSON.stringify(reactionState),
          reactionWitness: reactionWitness
        })
      }

      const postComemnts = await prisma.comments.findMany({
        where: {
          targetKey: post.postKey,
          commentBlockHeight: {
            not: 0
          }
        }
      });
      const numberOfComments = postComemnts.length;

      const postReposts = await prisma.reposts.findMany({
        where: {
          targetKey: post.postKey,
          repostBlockHeight: {
            not: 0
          }
        }
      });
      const numberOfReposts = postReposts.length;

      postsResponse.push({
        postState: JSON.stringify(postState),
        postKey: post.postKey,
        postContentID: post.postContentID,
        content: content,
        postWitness: postWitness,
        reactionsResponse: reactionsResponse,
        numberOfComments: numberOfComments,
        numberOfReposts: numberOfReposts
      })
    };

    return postsResponse;
  } catch(e) {
      console.error(e);
  }
});

// ============================================================================

server.get<{Querystring: CommentsQuery}>('/comments', async (request) => {
  try {
    const { targetKey, howMany, fromBlock, toBlock } = request.query;

    const comments = await prisma.comments.findMany({
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
        }
      }
    });

    const commentsResponse: {
      commentState: string,
      commentKey: string,
      commentContentID: string,
      content: string,
      commentWitness: JSON,
    }[] = [];

    for (const comment of comments) {
      const commenterAddress = PublicKey.fromBase58(comment.commenterAddress);
      const commentContentID = CircuitString.fromString(comment.commentContentID);
      const commentKey = Field(comment.commentKey);
      const commentWitness = commentsMap.getWitness(commentKey).toJSON();
      const content = await fs.readFile('./comments/' + comment.commentContentID, 'utf8');

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
        commentWitness: commentWitness,
      });
    };

    return commentsResponse;

  } catch (e) {
    console.log(e)
  }
});

// ============================================================================

server.get<{Querystring: RepostQuery}>('/reposts', async (request) => {
  try {
    const { howMany, fromBlock, toBlock, reposterAddress } = request.query;
    let reposts: {
      repostKey: string,
      isTargetPost: boolean,
      targetKey: string,
      reposterAddress: string,
      allRepostsCounter: bigint,
      userRepostsCounter: bigint,
      targetRepostsCounter: bigint,
      repostBlockHeight: bigint,
      deletionBlockHeight: bigint,
      restorationBlockHeight: bigint,
      repostSignature: string
    }[];

    if (reposterAddress === undefined) {
      reposts = await prisma.reposts.findMany({
        take: Number(howMany),
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
          reposterAddress: reposterAddress,
          repostBlockHeight: {
            not: 0,
            gte: fromBlock,
            lte: toBlock
          }
        }
      });
    }

    const repostsResponse: {
      repostState: string,
      repostWitness: JSON,
      postState: string,
      postKey: string,
      postContentID: string,
      content: string,
      postWitness: JSON,
      reactionsResponse: {
        reactionState: string,
        reactionWitness: JSON
      }[],
      numberOfComments: number,
      numberOfReposts: number
    }[] = [];

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
      const content = await fs.readFile('./posts/' + post!.postContentID, 'utf8');

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
          targetKey: postKey.toString(),
          reactionBlockHeight: {
            not: 0
          }
        }
      });

      const reactionsResponse: {
        reactionState: string,
        reactionWitness: JSON
      }[] = [];

      for (const reaction of postReactions) {
        const reactorAddress = PublicKey.fromBase58(reaction.reactorAddress);
        const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
        const reactionCodePointAsField = Field(reaction.reactionCodePoint);
        const reactionKey = Poseidon.hash([postKey, reactorAddressAsField, reactionCodePointAsField]);
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

        reactionsResponse.push({
          reactionState: JSON.stringify(reactionState),
          reactionWitness: reactionWitness
        })
      }

      const postComemnts = await prisma.comments.findMany({
        where: {
          targetKey: post!.postKey,
          commentBlockHeight: {
            not: 0
          }
        }
      });
      const numberOfComments = postComemnts.length;

      const postReposts = await prisma.reposts.findMany({
        where: {
          targetKey: post!.postKey,
          repostBlockHeight: {
            not: 0
          }
        }
      });
      const numberOfReposts = postReposts.length;

      repostsResponse.push({
        repostState: JSON.stringify(repostState),
        repostWitness: repostWitness,
        postState: JSON.stringify(postState),
        postKey: post!.postKey,
        postContentID: post!.postContentID,
        content: content,
        postWitness: postWitness,
        reactionsResponse: reactionsResponse,
        numberOfComments: numberOfComments,
        numberOfReposts: numberOfReposts
      })
    }

    return repostsResponse;
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

// ============================================================================

interface SignedPost {
  post: string,
  signedData: SignedData
}

// ============================================================================

interface SignedComment {
  comment: string,
  signedData: SignedData
}

// ============================================================================

interface PostsQuery {
  howMany: number,
  fromBlock: number,
  toBlock: number,
  posterAddress: string
}

// ============================================================================

interface RepostQuery {
  howMany: number,
  fromBlock: number,
  toBlock: number,
  reposterAddress: string
}

// ============================================================================

interface CommentsQuery {
  targetKey: string,
  howMany: number,
  fromBlock: number,
  toBlock: number
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

const createSQLPost = async (postKey: Field, signature: Signature, posterAddress: PublicKey,
  allPostsCounter: number, userPostsCounter: number, postCID: any) => {

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
      postSignature: signature.toBase58()
    }
  });
}

// ============================================================================

const createSQLReaction = async (reactionKey: Field, targetKey: Field, reactorAddress: string,
  reactionCodePoint: number, allReactionsCounter: number,
  userReactionsCounter: number, targetReactionsCounter:number,
  signature: string) => {

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
      reactionSignature: signature
    }
  });
}

// ============================================================================

const createSQLComment = async (commentKey: Field, targetKey: Field, commenterAddress: string,
  commentCID: any, allCommentsCounter: number,
  userCommentsCounter: number, targetCommentsCounter:number,
  signature: string) => {

  await prisma.comments.create({
    data: {
      commentKey: commentKey.toString(),
      isTargetPost: true,
      targetKey: targetKey.toString(),
      commenterAddress: commenterAddress,
      commentContentID: commentCID.toString(),
      allCommentsCounter: allCommentsCounter,
      userCommentsCounter: userCommentsCounter,
      targetCommentsCounter: targetCommentsCounter,
      commentBlockHeight: 0,
      deletionBlockHeight: 0,
      restorationBlockHeight: 0,
      commentSignature: signature
    }
  });
}

// ============================================================================

const createSQLRepost = async (repostKey: Field, targetKey: Field, reposterAddress: string,
  allRepostsCounter: number, userRepostsCounter: number, targetRepostsCounter:number,
  signature: string) => {

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
      repostSignature: signature
    }
  });
}

// ============================================================================