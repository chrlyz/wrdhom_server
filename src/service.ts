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
  RepostState,
  fieldToFlagPostsAsDeleted,
  fieldToFlagPostsAsRestored,
  fieldToFlagCommentsAsDeleted,
  fieldToFlagCommentsAsRestored,
  fieldToFlagRepostsAsDeleted,
  fieldToFlagRepostsAsRestored,
  fieldToFlagReactionsAsDeleted
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
let totalNumberOfPosts = 0;

const postsContext = {
  prisma: prisma,
  usersPostsCountersMap: usersPostsCountersMap,
  postsMap: postsMap,
  totalNumberOfPosts: totalNumberOfPosts
}

const posts = await regeneratePostsZkAppState(postsContext);

const usersReactionsCountersMap = new MerkleMap();
const targetsReactionsCountersMap =  new MerkleMap();
const reactionsMap = new MerkleMap();
let totalNumberOfReactions = 0;

const reactionsContext = {
  prisma: prisma,
  usersReactionsCountersMap: usersReactionsCountersMap,
  targetsReactionsCountersMap: targetsReactionsCountersMap,
  reactionsMap: reactionsMap,
  totalNumberOfReactions: totalNumberOfReactions
}

await regenerateReactionsZkAppState(reactionsContext);

const usersCommentsCountersMap = new MerkleMap();
const targetsCommentsCountersMap =  new MerkleMap();
const commentsMap = new MerkleMap();
let totalNumberOfComments = 0;

const commentsContext = {
  prisma: prisma,
  usersCommentsCountersMap: usersCommentsCountersMap,
  targetsCommentsCountersMap: targetsCommentsCountersMap,
  commentsMap: commentsMap,
  totalNumberOfComments: totalNumberOfComments
}

const comments = await regenerateCommentsZkAppState(commentsContext);

const usersRepostsCountersMap = new MerkleMap();
const targetsRepostsCountersMap =  new MerkleMap();
const repostsMap = new MerkleMap();
let totalNumberOfReposts = 0;

const repostsContext = {
  prisma: prisma,
  usersRepostsCountersMap: usersRepostsCountersMap,
  targetsRepostsCountersMap: targetsRepostsCountersMap,
  repostsMap: repostsMap,
  totalNumberOfReposts: totalNumberOfReposts
}

await regenerateRepostsZkAppState(repostsContext);

const postDeletions = await prisma.postDeletions.findMany({
  where: {
    deletionBlockHeight: {
      gt: 0
    }
  }
});
let totalNumberOfPostDeletions = postDeletions.length;
console.log('totalNumberOfPostDeletions: ' + totalNumberOfPostDeletions)

const postRestorations = await prisma.postRestorations.findMany({
  where: {
    restorationBlockHeight: {
      gt: 0
    }
  }
});
let totalNumberOfPostRestorations = postRestorations.length;
console.log('totalNumberOfPostRestorations: ' + totalNumberOfPostRestorations);

const commentDeletions = await prisma.commentDeletions.findMany({
  where: {
    deletionBlockHeight: {
      gt: 0
    }
  }
});
let totalNumberOfCommentDeletions = commentDeletions.length;
console.log('totalNumberOfCommentDeletions: ' + totalNumberOfCommentDeletions);

const commentRestorations = await prisma.commentRestorations.findMany({
  where: {
    restorationBlockHeight: {
      gt: 0
    }
  }
});
let totalNumberOfCommentRestorations = commentRestorations.length;
console.log('totalNumberOfCommentRestorations: ' + totalNumberOfCommentRestorations);

const repostDeletions = await prisma.repostDeletions.findMany({
  where: {
    deletionBlockHeight: {
      gt: 0
    }
  }
});
let totalNumberOfRepostDeletions = repostDeletions.length;
console.log('totalNumberOfRepostDeletions: ' + totalNumberOfRepostDeletions);

const repostRestorations = await prisma.repostRestorations.findMany({
  where: {
    restorationBlockHeight: {
      gt: 0
    }
  }
});
let totalNumberOfRepostRestorations = repostRestorations.length;
console.log('totalNumberOfRepostRestorations: ' + totalNumberOfRepostRestorations);

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
          gt: postsContext.totalNumberOfPosts
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
      postsContext.totalNumberOfPosts += 1;
    }

    const pendingReactions = await prisma.reactions.findMany({
      orderBy: {
        allReactionsCounter: 'asc'
      },
      where: {
        allReactionsCounter: {
          gt: reactionsContext.totalNumberOfReactions
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

      reactionsMap.set(Field(pReaction.reactionKey), reactionState.hash());

      const target = await prisma.posts.findUnique({
        where: {
          postKey: pReaction.targetKey
        }
      });
      const targetPosterAddress = Poseidon.hash(PublicKey.fromBase58(target!.posterAddress).toFields())
      usersReactionsCountersMap.set(targetPosterAddress, Field(pReaction.userReactionsCounter));
      targetsReactionsCountersMap.set(Field(target!.postKey), Field(pReaction.targetReactionsCounter));

      reactionsContext.totalNumberOfReactions += 1;
    }

    const pendingComments = await prisma.comments.findMany({
      orderBy: {
        allCommentsCounter: 'asc'
      },
      where: {
        allCommentsCounter: {
          gt: commentsContext.totalNumberOfComments
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

      commentsMap.set(Field(pComment.commentKey), commentState.hash());

      const target = await prisma.posts.findUnique({
        where: {
          postKey: pComment.targetKey
        }
      });
      const targetPosterAddress = Poseidon.hash(PublicKey.fromBase58(target!.posterAddress).toFields())
      usersCommentsCountersMap.set(targetPosterAddress, Field(pComment.userCommentsCounter));
      targetsCommentsCountersMap.set(Field(target!.postKey), Field(pComment.targetCommentsCounter));

      commentsContext.totalNumberOfComments += 1;
    }

    const pendingReposts = await prisma.reposts.findMany({
      orderBy: {
        allRepostsCounter: 'asc'
      },
      where: {
        allRepostsCounter: {
          gt: repostsContext.totalNumberOfReposts
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
    
      repostsMap.set(Field(pRepost.repostKey), repostState.hash());

      const target = await prisma.posts.findUnique({
        where: {
          postKey: pRepost.targetKey
        }
      });
      const targetPosterAddress = Poseidon.hash(PublicKey.fromBase58(target!.posterAddress).toFields())
      usersRepostsCountersMap.set(targetPosterAddress, Field(pRepost.userRepostsCounter));
      targetsRepostsCountersMap.set(Field(target!.postKey), Field(pRepost.targetRepostsCounter));

      repostsContext.totalNumberOfReposts += 1;
    }

    const pendingPostDeletions = await prisma.postDeletions.findMany({
      where: {
        allDeletionsCounter: {
          gt: totalNumberOfPostDeletions,
        },
        deletionBlockHeight: {
          gt: 0
        }
      }
    });

    for (const pPostDeletion of pendingPostDeletions) {
      const target = await prisma.posts.findUnique({
        where: {
          postKey: pPostDeletion.targetKey
        }
      });

      console.log(pPostDeletion);
      const postState = new PostState({
        posterAddress: PublicKey.fromBase58(target!.posterAddress),
        postContentID: CircuitString.fromString(target!.postContentID),
        allPostsCounter: Field(target!.allPostsCounter),
        userPostsCounter: Field(target!.userPostsCounter),
        postBlockHeight: Field(target!.postBlockHeight),
        deletionBlockHeight: Field(target!.deletionBlockHeight),
        restorationBlockHeight: Field(target!.restorationBlockHeight)
      });

      const postKey = Field(target!.postKey);
      postsMap.set(postKey, postState.hash());
      totalNumberOfPostDeletions += 1;
    }

    const pendingPostRestorations = await prisma.postRestorations.findMany({
      where: {
        allRestorationsCounter: {
          gt: totalNumberOfPostRestorations
        },
        restorationBlockHeight: {
          gt: 0
        }
      }
    });

    for (const pRestoration of pendingPostRestorations) {
      const target = await prisma.posts.findUnique({
        where: {
          postKey: pRestoration.targetKey
        }
      });

      console.log(pRestoration);
      const postState = new PostState({
        posterAddress: PublicKey.fromBase58(target!.posterAddress),
        postContentID: CircuitString.fromString(target!.postContentID),
        allPostsCounter: Field(target!.allPostsCounter),
        userPostsCounter: Field(target!.userPostsCounter),
        postBlockHeight: Field(target!.postBlockHeight),
        deletionBlockHeight: Field(target!.deletionBlockHeight),
        restorationBlockHeight: Field(target!.restorationBlockHeight)
      });

      const postKey = Field(target!.postKey);
      postsMap.set(postKey, postState.hash());
      totalNumberOfPostRestorations += 1;
    }

    const pendingCommentDeletions = await prisma.commentDeletions.findMany({
      where: {
        allDeletionsCounter: {
          gt: totalNumberOfCommentDeletions,
        },
        deletionBlockHeight: {
          gt: 0
        }
      }
    });

    for (const pCommentDeletion of pendingCommentDeletions) {
      const target = await prisma.comments.findUnique({
        where: {
          commentKey: pCommentDeletion.targetKey
        }
      });

      console.log(pCommentDeletion);
      const commentState = new CommentState({
        isTargetPost: Bool(target!.isTargetPost),
        targetKey: Field(target!.targetKey),
        commenterAddress: PublicKey.fromBase58(target!.commenterAddress),
        commentContentID: CircuitString.fromString(target!.commentContentID),
        allCommentsCounter: Field(target!.allCommentsCounter),
        userCommentsCounter: Field(target!.userCommentsCounter),
        targetCommentsCounter: Field(target!.targetCommentsCounter),
        commentBlockHeight: Field(target!.commentBlockHeight),
        deletionBlockHeight: Field(target!.deletionBlockHeight),
        restorationBlockHeight: Field(target!.restorationBlockHeight)
      });

      const commentKey = Field(target!.commentKey);
      commentsMap.set(commentKey, commentState.hash());
      totalNumberOfCommentDeletions += 1;
    }

    const pendingCommentRestorations = await prisma.commentRestorations.findMany({
      where: {
        allRestorationsCounter: {
          gt: totalNumberOfCommentRestorations,
        },
        restorationBlockHeight: {
          gt: 0
        }
      }
    });

    for (const pCommentRestoration of pendingCommentRestorations) {
      const target = await prisma.comments.findUnique({
        where: {
          commentKey: pCommentRestoration.targetKey
        }
      });

      console.log(pCommentRestoration);
      const commentState = new CommentState({
        isTargetPost: Bool(target!.isTargetPost),
        targetKey: Field(target!.targetKey),
        commenterAddress: PublicKey.fromBase58(target!.commenterAddress),
        commentContentID: CircuitString.fromString(target!.commentContentID),
        allCommentsCounter: Field(target!.allCommentsCounter),
        userCommentsCounter: Field(target!.userCommentsCounter),
        targetCommentsCounter: Field(target!.targetCommentsCounter),
        commentBlockHeight: Field(target!.commentBlockHeight),
        deletionBlockHeight: Field(target!.deletionBlockHeight),
        restorationBlockHeight: Field(target!.restorationBlockHeight)
      });

      const commentKey = Field(target!.commentKey);
      commentsMap.set(commentKey, commentState.hash());
      totalNumberOfCommentRestorations += 1;
    }

    const pendingRepostDeletions = await prisma.repostDeletions.findMany({
      where: {
        allDeletionsCounter: {
          gt: totalNumberOfRepostDeletions,
        },
        deletionBlockHeight: {
          gt: 0
        }
      }
    });

    for (const pRepostDeletion of pendingRepostDeletions) {
      const target = await prisma.reposts.findUnique({
        where: {
          repostKey: pRepostDeletion.targetKey
        }
      });

      console.log(pRepostDeletion);
      const repostState = new RepostState({
        isTargetPost: Bool(target!.isTargetPost),
        targetKey: Field(target!.targetKey),
        reposterAddress: PublicKey.fromBase58(target!.reposterAddress),
        allRepostsCounter: Field(target!.allRepostsCounter),
        userRepostsCounter: Field(target!.userRepostsCounter),
        targetRepostsCounter: Field(target!.targetRepostsCounter),
        repostBlockHeight: Field(target!.repostBlockHeight),
        deletionBlockHeight: Field(target!.deletionBlockHeight),
        restorationBlockHeight: Field(target!.restorationBlockHeight)
      });

      const repostKey = Field(target!.repostKey);
      repostsMap.set(repostKey, repostState.hash());
      totalNumberOfRepostDeletions += 1;
    }

    const pendingRepostRestorations = await prisma.repostRestorations.findMany({
      where: {
        allRestorationsCounter: {
          gt: totalNumberOfRepostRestorations,
        },
        restorationBlockHeight: {
          gt: 0
        }
      }
    });

    for (const pRepostRestoration of pendingRepostRestorations) {
      const target = await prisma.reposts.findUnique({
        where: {
          repostKey: pRepostRestoration.targetKey
        }
      });

      console.log(pRepostRestoration);
      const repostState = new RepostState({
        isTargetPost: Bool(target!.isTargetPost),
        targetKey: Field(target!.targetKey),
        reposterAddress: PublicKey.fromBase58(target!.reposterAddress),
        allRepostsCounter: Field(target!.allRepostsCounter),
        userRepostsCounter: Field(target!.userRepostsCounter),
        targetRepostsCounter: Field(target!.targetRepostsCounter),
        repostBlockHeight: Field(target!.repostBlockHeight),
        deletionBlockHeight: Field(target!.deletionBlockHeight),
        restorationBlockHeight: Field(target!.restorationBlockHeight)
      });

      const repostKey = Field(target!.repostKey);
      repostsMap.set(repostKey, repostState.hash());
      totalNumberOfRepostRestorations += 1;
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

      await web3storage.uploadFile(file);
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

      await web3storage.uploadFile(file);
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

server.post<{Body: SignedPostDeletion}>('/posts/delete', async (request) => {

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const posterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const postKey = request.body.postKey;

  const post = await prisma.posts.findUnique({
    where: {
      postKey: postKey
    }
  });

  if (post !== null && post?.deletionBlockHeight !== 0n) {
    return 'Post is already deleted';
  }

  const pendingDeletion = await prisma.postDeletions.findFirst({
    where: {
      targetKey: postKey
    }
  });
  
  if (pendingDeletion !== null && pendingDeletion?.deletionBlockHeight === 0n) {
    return 'Post deletion is already pending';
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
    console.log(postKey);
    const allDeletionsCounter = (await prisma.postDeletions.count()) + 1;
    console.log('allPostDeletionsCounter: ' + allDeletionsCounter);

    const deletionsForTarget = await prisma.postDeletions.findMany({
      where: {
        targetKey: postKey
      }
    });
    const targetDeletionsCounter = deletionsForTarget.length + 1;
    console.log('targetPostDeletionsCounter: ' + targetDeletionsCounter);

    await prisma.postDeletions.create({
      data: {
        targetKey: postKey,
        allDeletionsCounter: allDeletionsCounter,
        targetDeletionsCounter: targetDeletionsCounter,
        deletionBlockHeight: 0,
        deletionSignature: request.body.signedData.signature
      }
    });

    return 'Valid Post Deletion!';
  } else {
    return 'Post deletion message is not signed';
  }
});

// ============================================================================

server.post<{Body: SignedCommentDeletion}>('/comments/delete', async (request) => {

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const commenterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const targetKey = request.body.targetKey;
  const commentKey = request.body.commentKey;

  const comment = await prisma.comments.findUnique({
    where: {
      commentKey: commentKey
    }
  });

  if (comment !== null && comment?.deletionBlockHeight !== 0n) {
    return 'Comment is already deleted';
  }

  const pendingDeletion = await prisma.commentDeletions.findFirst({
    where: {
      targetKey: commentKey
    }
  })
  
  if (pendingDeletion !== null && pendingDeletion?.deletionBlockHeight === 0n) {
    return 'Comment deletion is already pending';
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
    console.log(commentKey);
    const allDeletionsCounter = (await prisma.commentDeletions.count()) + 1;
    console.log('allCommentDeletionsCounter: ' + allDeletionsCounter);

    const deletionsForTarget = await prisma.commentDeletions.findMany({
      where: {
        targetKey: commentKey
      }
    });
    const targetDeletionsCounter = deletionsForTarget.length + 1;
    console.log('targetCommentDeletionsCounter: ' + targetDeletionsCounter);

    await prisma.commentDeletions.create({
      data: {
        targetKey: commentKey,
        allDeletionsCounter: allDeletionsCounter,
        targetDeletionsCounter: targetDeletionsCounter,
        deletionBlockHeight: 0,
        deletionSignature: request.body.signedData.signature
      }
    });

    return 'Valid Comment Deletion!';
  } else {
    return 'Comment deletion message is not signed';
  }
});

// ============================================================================

server.post<{Body: SignedReactionDeletion}>('/reactions/delete', async (request) => {

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

  const pendingDeletion = await prisma.reactionDeletions.findFirst({
    where: {
      targetKey: reactionKeyAsString
    }
  })
  
  if (pendingDeletion !== null && pendingDeletion?.deletionBlockHeight === 0n) {
    return 'Reaction deletion is already pending';
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
    console.log(reactionKey);
    const allDeletionsCounter = (await prisma.reactionDeletions.count()) + 1;
    console.log('allReactionDeletionsCounter: ' + allDeletionsCounter);

    const deletionsForTarget = await prisma.reactionDeletions.findMany({
      where: {
        targetKey: reactionKeyAsString
      }
    });
    const targetDeletionsCounter = deletionsForTarget.length + 1;
    console.log('targetReactionDeletionsCounter: ' + targetDeletionsCounter);

    await prisma.reactionDeletions.create({
      data: {
        targetKey: reactionKeyAsString,
        allDeletionsCounter: allDeletionsCounter,
        targetDeletionsCounter: targetDeletionsCounter,
        deletionBlockHeight: 0,
        deletionSignature: request.body.signedData.signature
      }
    });

    return 'Valid Reaction Deletion!';
  } else {
    return 'Reaction deletion message is not signed';
  }
});

// ============================================================================

server.post<{Body: SignedRepostDeletion}>('/reposts/delete', async (request) => {

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

  const pendingDeletion = await prisma.repostDeletions.findFirst({
    where: {
      targetKey: repostKey
    }
  });
  
  if (pendingDeletion !== null && pendingDeletion?.deletionBlockHeight === 0n) {
    return 'Repost deletion is already pending';
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
    console.log(repostKey);
    const allDeletionsCounter = (await prisma.repostDeletions.count()) + 1;
    console.log('allRepostDeletionsCounter: ' + allDeletionsCounter);

    const deletionsForTarget = await prisma.repostDeletions.findMany({
      where: {
        targetKey: repostKey
      }
    });
    const targetDeletionsCounter = deletionsForTarget.length + 1;
    console.log('targetRepostDeletionsCounter: ' + targetDeletionsCounter);

    await prisma.repostDeletions.create({
      data: {
        targetKey: repostKey,
        allDeletionsCounter: allDeletionsCounter,
        targetDeletionsCounter: targetDeletionsCounter,
        deletionBlockHeight: 0,
        deletionSignature: request.body.signedData.signature
      }
    });

    return 'Valid Repost Deletion!';
  } else {
    return 'Repost deletion message is not signed';
  }
});

// ============================================================================

server.post<{Body: SignedPostRestoration}>('/posts/restore', async (request) => {

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

  const pendingRestoration = await prisma.postRestorations.findFirst({
    where: {
      targetKey: postKey
    }
  })


  if (pendingRestoration !== null && pendingRestoration?.restorationBlockHeight === 0n) {
    return 'Post restoration is already pending';
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
    console.log(request.body.postKey);
    const allRestorationsCounter = (await prisma.postRestorations.count()) + 1;
    console.log('allPostRestorationsCounter: ' + allRestorationsCounter);

    const restorationsForTarget = await prisma.postRestorations.findMany({
      where: {
        targetKey: request.body.postKey
      }
    });
    const targetRestorationsCounter = restorationsForTarget.length + 1;
    console.log('targetPostRestorationsCounter: ' + targetRestorationsCounter);

    await prisma.postRestorations.create({
      data: {
        targetKey: request.body.postKey,
        allRestorationsCounter: allRestorationsCounter,
        targetRestorationsCounter: targetRestorationsCounter,
        restorationBlockHeight: 0,
        restorationSignature: request.body.signedData.signature
      }
    });

    return 'Valid Restoration!';
  } else {
    return 'Post restoration message is not signed';
  }
});

// ============================================================================

server.post<{Body: SignedCommentRestoration}>('/comments/restore', async (request) => {

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const commenterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const commentKey = request.body.commentKey;

  const comment = await prisma.comments.findUnique({
    where: {
      commentKey: commentKey
    }
  });

  if(Number(comment!.deletionBlockHeight) === 0) {
    return 'Comment has not been deleted, so it cannot be restored';
  }

  const pendingRestoration = await prisma.postRestorations.findFirst({
    where: {
      targetKey: commentKey
    }
  })

  
  if (pendingRestoration !== null && pendingRestoration?.restorationBlockHeight === 0n) {
    return 'Comment restoration is already pending';
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
    console.log(request.body.commentKey);
    const allRestorationsCounter = (await prisma.commentRestorations.count()) + 1;
    console.log('allCommentsRestorationsCounter: ' + allRestorationsCounter);

    const restorationsForTarget = await prisma.commentRestorations.findMany({
      where: {
        targetKey: request.body.commentKey
      }
    });
    const targetRestorationsCounter = restorationsForTarget.length + 1;
    console.log('targetCommentsRestorationsCounter: ' + targetRestorationsCounter);

    await prisma.commentRestorations.create({
      data: {
        targetKey: request.body.commentKey,
        allRestorationsCounter: allRestorationsCounter,
        targetRestorationsCounter: targetRestorationsCounter,
        restorationBlockHeight: 0,
        restorationSignature: request.body.signedData.signature
      }
    });

    return 'Valid Restoration!';
  } else {
    return 'Comment restoration message is not signed';
  }
});

// ============================================================================

server.post<{Body: SignedRepostRestoration}>('/reposts/restore', async (request) => {

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

  const pendingRestoration = await prisma.repostRestorations.findFirst({
    where: {
      targetKey: repostKey
    }
  });

  if (pendingRestoration !== null && pendingRestoration!.restorationBlockHeight === 0n) {
    return 'Repost restoration is already pending';
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
    console.log(request.body.repostKey);
    const allRestorationsCounter = (await prisma.repostRestorations.count()) + 1;
    console.log('allRepostsRestorationsCounter: ' + allRestorationsCounter);

    const restorationsForTarget = await prisma.repostRestorations.findMany({
      where: {
        targetKey: request.body.repostKey
      }
    });
    const targetRestorationsCounter = restorationsForTarget.length + 1;
    console.log('targetRepostsRestorationsCounter: ' + targetRestorationsCounter);

    await prisma.repostRestorations.create({
      data: {
        targetKey: request.body.repostKey,
        allRestorationsCounter: allRestorationsCounter,
        targetRestorationsCounter: targetRestorationsCounter,
        restorationBlockHeight: 0,
        restorationSignature: request.body.signedData.signature
      }
    });

    return 'Valid Restoration!';
  } else {
    return 'Repost restoration message is not signed';
  }
});

// ============================================================================

server.get<{Querystring: PostsQuery}>('/posts', async (request) => {
  try {
    const { howMany, fromBlock, toBlock, posterAddress, postKey } = request.query;

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
    let numberOfPosts: number;
    let numberOfPostsWitness: string;

    if (posterAddress === undefined) {
      numberOfPosts = (await prisma.posts.findMany({
        where: {
          postBlockHeight: {
            not: 0
          }
        }
      })).length;
      numberOfPostsWitness = JSON.parse('{"profile": false}');

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
      numberOfPosts = (await prisma.posts.findMany({
        where: {
          posterAddress: posterAddress,
          postBlockHeight: {
            not: 0
          }
        }
      })).length;
      const posterAddressAsField = Poseidon.hash(PublicKey.fromBase58(posterAddress).toFields());
      numberOfPostsWitness = usersPostsCountersMap.getWitness(posterAddressAsField).toJSON();

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

    const postsResponse: PostsResponse[] = [];

    for (const post of posts) {
      const posterAddress = PublicKey.fromBase58(post.posterAddress);
      const postContentID = CircuitString.fromString(post.postContentID);
      const postKey = Field(post.postKey);
      const postWitness = postsMap.getWitness(postKey).toJSON();

      let content = '';
      if (post.deletionBlockHeight === BigInt(0)) {
        content = await fs.readFile('./posts/' + post.postContentID, 'utf8');
      }

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
        numberOfRepostsWitness: JSON.stringify(numberOfRepostsWitness)
      });
    };

    const response = {
      numberOfPosts: numberOfPosts,
      numberOfPostsWitness: JSON.stringify(numberOfPostsWitness),
      postsResponse: postsResponse
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

    const numberOfComments = (await prisma.comments.findMany({
      where: {
        targetKey: targetKey,
        commentBlockHeight: {
          not: 0
        }
      }
    })).length;
    const numberOfCommentsWitness = targetsCommentsCountersMap.getWitness(Field(targetKey)).toJSON();

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

    const response = {
      numberOfComments: numberOfComments,
      numberOfCommentsWitness: JSON.stringify(numberOfCommentsWitness),
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
    const { howMany, fromBlock, toBlock, reposterAddress, repostKey } = request.query;

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
    let numberOfReposts: number;
    let numberOfRepostsWitness: JSON;

    if (reposterAddress === undefined) {
      numberOfReposts = (await prisma.reposts.findMany({
        where: {
          repostBlockHeight: {
            not: 0
          }
        }
      })).length;
      numberOfRepostsWitness = JSON.parse('{"profile": false}');

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
      numberOfReposts = (await prisma.reposts.findMany({
        where: {
          reposterAddress: reposterAddress,
          repostBlockHeight: {
            not: 0
          }
        }
      })).length;
      const reposterAddressAsField = Poseidon.hash(PublicKey.fromBase58(reposterAddress).toFields());
      numberOfRepostsWitness = usersRepostsCountersMap.getWitness(reposterAddressAsField).toJSON();

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
      numberOfReposts: numberOfReposts,
      numberOfRepostsWitness: JSON.stringify(numberOfRepostsWitness),
      repostsResponse: repostsResponse
    }

    return response;

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
  posterAddress: string,
  postKey: string
}

// ============================================================================

interface RepostQuery {
  howMany: number,
  fromBlock: number,
  toBlock: number,
  reposterAddress: string,
  repostKey: string
}

// ============================================================================

interface CommentsQuery {
  targetKey: string,
  howMany: number,
  fromBlock: number,
  toBlock: number,
  commentKey: string
}

// ============================================================================

interface SignedPostDeletion {
  postKey: string,
  signedData: SignedData
}

// ============================================================================

interface SignedCommentDeletion {
  targetKey: string,
  commentKey: string,
  signedData: SignedData
}

// ============================================================================

interface SignedReactionDeletion {
  reactionState: string,
  signedData: SignedData
}

// ============================================================================

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

// ============================================================================

interface SignedCommentRestoration {
  targetKey: string,
  commentKey: string,
  signedData: SignedData
}

// ============================================================================

interface SignedRepostRestoration {
  targetKey: string,
  repostKey: string,
  signedData: SignedData
}

// ============================================================================

type EmbeddedReactions = {
  reactionState: string,
  reactionWitness: string
}

// ============================================================================

type EmbeddedComments = {
  commentState: string,
  commentWitness: string
}

// ============================================================================

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
  numberOfRepostsWitness: string
}

// ============================================================================

type CommentsResponse = {
  commentState: string,
  commentKey: string,
  commentContentID: string,
  content: string,
  commentWitness: string,
}

// ============================================================================

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