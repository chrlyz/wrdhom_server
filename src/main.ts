import fastify from 'fastify';
import { CircuitString, PublicKey, Signature, fetchLastBlock} from 'o1js';
import { SignedData } from '@aurowallet/mina-provider';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';

// ============================================================================

const server = fastify();
await server.register(cors, { 
  origin: 'http://localhost:3000',
  methods: ['POST']
});

const prisma = new PrismaClient();

server.post<{Body: SignedData}>('/posts*', async (request, reply) => {

  const signatureJSON = {
    r: request.body.signature.field,
    s: request.body.signature.scalar
  }

  const signature = Signature.fromJSON(signatureJSON);

  const isSigned = signature.verify(
    PublicKey.fromBase58(request.body.publicKey), 
    [CircuitString.fromString(request.body.data).hash()]
  )
  
  if (isSigned) {
    const allpostscounter = await prisma.posts.count();

    const userpostsCID = await prisma.posts.findMany({
      where: {
        posteraddress: request.body.publicKey
      },
      select: {
        postcontentid: true
      }
    });
    const userpostscounter = userpostsCID.length;

    const lastBlock = await fetchLastBlock('https://proxy.berkeley.minaexplorer.com/graphql');
    const postblockheight = lastBlock.blockchainLength.toBigint();

    await prisma.posts.create({
      data: {
        posteraddress: request.body.publicKey,
        postcontentid: request.body.data,
        allpostscounter: (allpostscounter + 1),
        userpostscounter: (userpostscounter + 1),
        postblockheight: postblockheight,
        deletionblockheight: 0
      }
    })

    return request.body;
  } else {
    reply.code(401).send({error: `Post isn't signed`});
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