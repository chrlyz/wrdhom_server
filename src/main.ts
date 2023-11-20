import fastify from 'fastify';
import { CircuitString, PublicKey, Signature} from 'o1js';
import { SignedData } from '@aurowallet/mina-provider';
import cors from '@fastify/cors'

// ============================================================================

const server = fastify();
await server.register(cors, { 
  origin: 'http://localhost:3000',
  methods: ['POST']
});

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