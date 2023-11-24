import fastify from 'fastify';
import { CircuitString, PublicKey, Signature, fetchLastBlock} from 'o1js';
import { SignedData } from '@aurowallet/mina-provider';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { createFileEncoderStream, CAREncoderStream } from 'ipfs-car';
import { Blob } from '@web-std/file';
import { create } from '@web3-storage/w3up-client';
import { PostState, PostsTransition, Posts, PostsContract } from 'wrdhom';

// ============================================================================

const server = fastify();
await server.register(cors, { 
  origin: 'http://localhost:3000',
  methods: ['POST']
});

const prisma = new PrismaClient();

const web3storage = await create();
console.log('Logging-in to web3.storage...');
await web3storage.login('chrlyz@skiff.com');
await web3storage.setCurrentSpace('did:key:z6Mkj6kybvJKUYQNCGvg7vKPayZdn272rPLsVQzF8oDAV8B7');

// ============================================================================

server.post<{Body: SignedPost}>('/posts*', async (request, reply) => {

  const signatureJSON = {
    r: request.body.signedData.signature.field,
    s: request.body.signedData.signature.scalar
  }

  const signature = Signature.fromJSON(signatureJSON);
  const posterAddress = request.body.signedData.publicKey;
  const postContentID = request.body.signedData.data;

  const file = new Blob([request.body.post]);
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

  if (postCID.toString() === postContentID) {
    const isSigned = signature.verify(
      PublicKey.fromBase58(posterAddress), 
      [CircuitString.fromString(postContentID).hash()]
    );
    
    if (isSigned) {

      const uploadedFile = await web3storage.uploadFile(file);

      await createSQLPost(posterAddress, postContentID, signature);

      return request.body;
    } else {
        reply.code(401).send({error: `Post isn't signed`});
    }
  } else {
      reply.code(401).send({error: `Derived post CID, doesn't match signed post CID`});
  }
});

server.listen({ port: 3001 }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Server listening at ${address}`)
});

// ============================================================================

interface SignedPost {
  post: string,
  signedData: SignedData
}

// ============================================================================

const createSQLPost = async (posterAddress: string, postContentID: string, signature: Signature) => {
  const allpostscounter = await prisma.posts.count();
  const userpostsCID = await prisma.posts.findMany({
    where: {
      posterAddress: posterAddress
    },
    select: {
      postContentID: true
    }
  });
  const userpostscounter = userpostsCID.length;

  await prisma.posts.create({
    data: {
      posterAddress: posterAddress,
      postContentID: postContentID,
      allPostsCounter: (allpostscounter + 1),
      userPostsCounter: (userpostscounter + 1),
      deletionBlockHeight: 0,
      minaSignature: signature.toBase58()
    }
  });
}