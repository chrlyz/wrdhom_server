import fastify from 'fastify';
import { CircuitString, PublicKey, Signature, Field, MerkleMap, Poseidon } from 'o1js';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { createFileEncoderStream, CAREncoderStream } from 'ipfs-car';
import { Blob } from '@web-std/file';
import { create } from '@web3-storage/w3up-client';
import * as dotenv from 'dotenv';
import { regenerateZkAppState } from './utils/state.js';
import { PostState } from 'wrdhom';
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

const context = {
  prisma: prisma,
  usersPostsCountersMap: usersPostsCountersMap,
  postsMap: postsMap,
  numberOfPosts: numberOfPosts
}

const posts = await regenerateZkAppState(context);

// Get posts content and keep it locally for faster reponses

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
          gt: context.numberOfPosts
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

      const postKey = Poseidon.hash([
        Poseidon.hash(postState.posterAddress.toFields()),
        postState.postContentID.hash()
      ]);

      postsMap.set(postKey, postState.hash());
      context.numberOfPosts += 1;
    }
  },
  (e) => {console.error(e)}
)
const syncStateJob = new SimpleIntervalJob({ seconds: 20, }, syncStateTask)

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

server.post<{Body: SignedPost}>('/posts*', async (request, reply) => {

  console.log(request.body.signedData);

  // Check that content and signed CID match
  const signature = Signature.fromBase58(request.body.signedData.signature);
  const posterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const postContentIDAsBigInt = Field(request.body.signedData.data[0]).toBigInt();
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

      const userPostsCID = await prisma.posts.findMany({
        where: {
          posterAddress: posterAddress.toBase58()
        },
        select: {
          postContentID: true
        }
      });
      const userPostsCounter = (userPostsCID.length) + 1;
      console.log('userPostsCounter: ' + userPostsCounter);

      await web3storage.uploadFile(file);
      await createSQLPost(signature, posterAddress, allPostsCounter, userPostsCounter, postCID);
      return request.body;
    } else {
        return `Post isn't signed`;
    }
  } else {
      return `Derived post CID, doesn't match signed post CID`;
  }
});

// ============================================================================

server.get<{Querystring: PostsQuery}>('/posts', async (request) => {
  try {
    const { howMany } = request.query;
    const posts = await prisma.posts.findMany({
      take: Number(howMany),
      orderBy: {
        allPostsCounter: 'desc'
      },
      where: {
        postBlockHeight: {
          not: 0
        }
      }
    });

    const postsResponse: {
      postState: string,
      postContentID: string,
      content: string,
      postWitness: JSON
    }[] = [];

    for (const post of posts) {
      const posterAddress = PublicKey.fromBase58(post.posterAddress);
      const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
      const postContentID = CircuitString.fromString(post.postContentID);
      const postKey = Poseidon.hash([posterAddressAsField, postContentID.hash()]);
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

      postsResponse.push({
        postState: JSON.stringify(postState),
        postContentID: post.postContentID,
        content: content,
        postWitness: postWitness
      })
    };

    console.log(postsResponse);

    return postsResponse;
  } catch(e) {
      console.error(e);
  }
});

// ============================================================================

interface SignedPost {
  post: string,
  signedData: {
    signature: string,
    publicKey: string,
    data: string[]
  }
}

// ============================================================================

interface PostsQuery {
  howMany: number,
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

const createSQLPost = async (signature: Signature, posterAddress: PublicKey,
  allPostsCounter: number, userPostsCounter: number, postCID: any) => {

  await prisma.posts.create({
    data: {
      posterAddress: posterAddress.toBase58(),
      postContentID: postCID.toString(),
      allPostsCounter: allPostsCounter,
      userPostsCounter: userPostsCounter,
      postBlockHeight: 0,
      deletionBlockHeight: 0,
      restorationBlockHeight: 0,
      minaSignature: signature.toBase58()
    }
  });
}