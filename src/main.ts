import fastify from 'fastify';
import { createFileEncoderStream, CAREncoderStream } from 'ipfs-car';
import { CircuitString, PublicKey, Signature } from 'o1js';

// ============================================================================

const server = fastify();

server.post<{Body: CreatePost}>('/', async (request, reply) => {
  const isSigned = await validatePost(
    request.body.posterAddress,
    request.body.postContent,
    request.body.signature
    );
  
  if (isSigned) {
    return request.body;
  } else {
    reply.code(401).send({error: `Post isn't signed`});
  }
});

server.listen({ port: 8080 }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`Server listening at ${address}`)
});

// ============================================================================

interface CreatePost {
  posterAddress: string;
  postContent: string;
  signature: string;
}

// ============================================================================

async function validatePost(
  posterAddressBase58: string,
  postContent: string,
  signatureBase58: string
  ) {
  const posterAddress =  PublicKey.fromBase58(posterAddressBase58);
  const signature = Signature.fromBase58(signatureBase58);

  let postCID: any;
  const file = new Blob([postContent]);
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

  const isSigned = signature.verify(
    posterAddress,
    [CircuitString.fromString(postCID.toString()).hash()]
  );

  return isSigned.toBoolean();
}

// ============================================================================