import fastify from 'fastify';
import { CircuitString, PublicKey, Signature, Field, MerkleMap, Poseidon, Bool } from 'o1js';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { createFileEncoderStream, CAREncoderStream } from 'ipfs-car';
import { Blob } from '@web-std/file';
import { create } from '@web3-storage/w3up-client';
import * as dotenv from 'dotenv';
import { regeneratePostsZkAppState, regenerateReactionsZkAppState } from './utils/state.js';
import { PostState, ReactionState } from 'wrdhom';
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
let numberOfRections = 0;

const reactionsContext = {
  prisma: prisma,
  usersReactionsCountersMap: usersReactionsCountersMap,
  targetsReactionsCountersMap: targetsReactionsCountersMap,
  reactionsMap: reactionsMap,
  numberOfRections: numberOfRections
}

await regenerateReactionsZkAppState(reactionsContext);

// Get posts content and keep it locally for faster reponses

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
      const contentResponse = await fetch('https://' + pPost.postContentID + '.ipfs.w3s.link');
      const content = await contentResponse.text();
      await fs.writeFile('./posts/' + pPost.postContentID, content, 'utf-8');

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
          gt: reactionsContext.numberOfRections
        },
        reactionBlockHeight: {
          not: 0
        }
      }
    });
    for (const pReaction of pendingReactions) {
      const reactorAddress = PublicKey.fromBase58(pReaction.reactorAddress);
      const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
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
      reactionsContext.numberOfRections += 1;
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

server.post<{Body: SignedReaction}>('/reactions', async (request) => {
  console.log('reactions');

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const reactorAddress = PublicKey.fromBase58(request.body.signedData.publicKey);

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

  const reactionEmojiCodePoint = Number(request.body.signedData.data[1]);
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
      Field(request.body.signedData.data[1])
    ]).toBoolean();
    const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
    const reactionCodePointAsField = Field(reactionEmojiCodePoint);
    const reactionKey = Poseidon.hash([targetKey, reactorAddressAsField, reactionCodePointAsField]);

    if (isSigned) {
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

      await createSQLReaction(reactionKey, targetKey, request.body.signedData.publicKey, reactionEmojiCodePoint,
        allReactionsCounter, userReactionsCounter, targetReactionsCounter, request.body.signedData.signature)
      return 'Valid Reaction!';
    } else {
      return 'Reaction message is not signed';
    }
  } else {
    return `The reaction value isn't a valid emoji`;
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
    console.log(posterAddress)

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
      postContentID: string,
      content: string,
      postWitness: JSON,
      reactionsResponse: {
        reactionState: string,
        reactionWitness: JSON
      }[]
    }[] = [];

    for (const post of posts) {
      const posterAddress = PublicKey.fromBase58(post.posterAddress);
      const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
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

      postsResponse.push({
        postState: JSON.stringify(postState),
        postContentID: post.postContentID,
        content: content,
        postWitness: postWitness,
        reactionsResponse: reactionsResponse
      })
    };

    console.log(postsResponse);

    return postsResponse;
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

interface PostsQuery {
  howMany: number,
  fromBlock: number,
  toBlock: number,
  posterAddress: string
}

// ============================================================================

interface SignedReaction {
  posterAddress: string,
  postContentID: string,
  signedData: SignedData
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