import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

await prisma.posts.update({
    where: {
        posterAddress_postContentID: {
            posterAddress: 'B62qkNA6xbiLdVcwjHYWBMEcg89WCq5XeTxFh96n9hP2HqeLkYKfkMr',
            postContentID: 'bafkreid7rrxvrucfaotyjhixalxdbu76tuqzykzlgziyfhmolfuhidnlqi'
        }
    },
    data: {
        postBlockHeight: BigInt(21902)
    }
});