import fastify from 'fastify';
import { CircuitString, PublicKey, Signature, Field } from 'o1js';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { createFileEncoderStream, CAREncoderStream } from 'ipfs-car';
import { Blob } from '@web-std/file';
import { create } from '@web3-storage/w3up-client';
import * as dotenv from 'dotenv';

// ============================================================================

// Load .env

dotenv.config();

// Set up client for PostgreSQL for structured data

const prisma = new PrismaClient();

// Set up client for IPFS for unstructured data

const web3storage = await create();
console.log('---Logging-in to web3.storage...');
await web3storage.login(process.env.W3S_EMAIL as `${string}@${string}`);
await web3storage.setCurrentSpace(process.env.W3S_SPACE as `did:${string}:${string}`);

// ============================================================================

// Instantiate Fastify server and set up configurations

const server = fastify();
await server.register(cors, { 
  origin: 'http://localhost:3000',
  methods: ['POST']
});

server.listen({ port: 3001 }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Server listening at ${address}`)
});

server.post<{Body: SignedPost}>('/posts*', async (request, reply) => {

  console.log(request.body.signedData);

  const signature = Signature.fromBase58(request.body.signedData.signature);
  const posterAddress = PublicKey.fromBase58(request.body.signedData.publicKey);
  const postContentIDAsBigInt = Field(request.body.signedData.data[0]).toBigInt();
  const file = new Blob([request.body.post]);
  console.log(request.body.post);
  const postCID = await getCID(file);
  console.log('postCID: ' + postCID);
  const postCIDAsBigInt = CircuitString.fromString(postCID.toString()).hash().toBigInt();

  // Check that content and signed CID match
  const isContentValid = postCIDAsBigInt === postContentIDAsBigInt;
  console.log('Is Content Valid? ' + isContentValid);
  if (isContentValid) {

    const isSigned = signature.verify(
      posterAddress,
      [CircuitString.fromString(postCID.toString()).hash()]
    ).toBoolean();
    console.log('Is Signed? ' + isSigned);
    
    // Check that the signature is valid
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
        reply.code(401).send({error: `Post isn't signed`});
    }
  } else {
      reply.code(401).send({error: `Derived post CID, doesn't match signed post CID`});
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