import { PrismaClient } from '@prisma/client';
import { MerkleMap, Poseidon, PublicKey, CircuitString, Field } from 'o1js';
import { PostState } from 'wrdhom';

// ============================================================================

export async function regenerateZkAppState(context: {
    prisma: PrismaClient,
    usersPostsCountersMap: MerkleMap,
    postsMap: MerkleMap,
    numberOfPosts: number
}
) {
    const posts = await context.prisma.posts.findMany({
      orderBy: {
        allPostsCounter: 'asc'
      },
      where: {
        postBlockHeight: {
          not: 0
        }
      }
    });
    console.log('posts:');
    console.log(posts)
    
    const posters = new Set(posts.map( post => post.posterAddress));
    console.log('posters:');
    console.log(posters);
    
    for (const poster of posters) {
    const userPosts = await context.prisma.posts.findMany({
      where: { posterAddress: poster,
      postBlockHeight: {
      not: 0
      } },
      select: {
        userPostsCounter: true
      }
    });
    console.log('Initial usersPostsCountersMap root: ' + context.usersPostsCountersMap.getRoot().toString());
    context.usersPostsCountersMap.set(
      Poseidon.hash(PublicKey.fromBase58(poster).toFields()),
      Field(userPosts.length)
    );
    console.log(userPosts.length);
    console.log('Latest usersPostsCountersMap root: ' + context.usersPostsCountersMap.getRoot().toString());
    };
    
    posts.forEach( post => {
      const posterAddress = PublicKey.fromBase58(post.posterAddress);
      const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
      const postContentID = CircuitString.fromString(post.postContentID);
      const postState = new PostState({
        posterAddress: posterAddress,
        postContentID: postContentID,
        allPostsCounter: Field(post.allPostsCounter),
        userPostsCounter: Field(post.userPostsCounter),
        postBlockHeight: Field(post.postBlockHeight),
        deletionBlockHeight: Field(post.deletionBlockHeight),
        restorationBlockHeight: Field(post.restorationBlockHeight)
      });
      console.log('Initial postsMap root: ' + context.postsMap.getRoot().toString());
      context.postsMap.set(
        Poseidon.hash([posterAddressAsField, postContentID.hash()]),
        postState.hash()
      );
      console.log('Latest postsMap root: ' + context.postsMap.getRoot().toString());
    });
    
    context.numberOfPosts = posts.length;
    console.log('Original number of posts: ' + context.numberOfPosts);

    return posts;
}

// ============================================================================