import { PrismaClient } from '@prisma/client';
import { MerkleMap, Poseidon, PublicKey, CircuitString, Field, Bool } from 'o1js';
import { PostState, ReactionState } from 'wrdhom';

// ============================================================================

export async function regeneratePostsZkAppState(context: {
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
        }
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

export async function regenerateReactionsZkAppState(context: {
  prisma: PrismaClient,
  usersReactionsCountersMap: MerkleMap,
  targetsReactionsCountersMap: MerkleMap,
  reactionsMap: MerkleMap,
  numberOfRections: number
}
) {
  const reactions = await context.prisma.reactions.findMany({
    orderBy: {
      allReactionsCounter: 'asc'
    },
    where: {
      reactionBlockHeight: {
        not: 0
      }
    }
  });
  console.log('reactions:');
  console.log(reactions)
  
  const reactors = new Set(reactions.map( reaction => reaction.reactorAddress));
  console.log('posters:');
  console.log(reactors);
  
  for (const reactor of reactors) {
    const userReactions = await context.prisma.reactions.findMany({
      where: {
        reactorAddress: reactor,
        reactionBlockHeight: {
        not: 0
        }
      }
    });
    console.log('Initial usersReactionsCountersMap root: ' + context.usersReactionsCountersMap.getRoot().toString());
    context.usersReactionsCountersMap.set(
      Poseidon.hash(PublicKey.fromBase58(reactor).toFields()),
      Field(userReactions.length)
    );
    console.log(userReactions.length);
    console.log('Latest usersReactionsCountersMap root: ' + context.usersReactionsCountersMap.getRoot().toString());
  };

  const targets = new Set(reactions.map( reaction => reaction.targetKey));
  console.log('targets');
  console.log(targets);

  for (const target of targets) {
    const targetReactions = await context.prisma.reactions.findMany({
      where: {
        targetKey: target,
        reactionBlockHeight: {
          not: 0
        }
      }
    })
    console.log('Initial targetsReactionsCountersMap root: ' + context.targetsReactionsCountersMap.getRoot().toString());
    context.targetsReactionsCountersMap.set(
      Field(target),
      Field(targetReactions.length)
    );
    console.log(targetReactions.length);
    console.log('Latest targetsReactionsCountersMap root: ' + context.targetsReactionsCountersMap.getRoot().toString());
  }
  
  reactions.forEach( reaction => {
    const reactorAddress = PublicKey.fromBase58(reaction.reactorAddress);
    const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
    const reactionCodePointAsField = Field(reaction.reactionCodePoint);
    const targetKey = Field(reaction.targetKey);

    const reactionState = new ReactionState({
      isTargetPost: Bool(reaction.isTargetPost),
      targetKey: targetKey,
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePointAsField,
      allReactionsCounter: Field(reaction.allReactionsCounter),
      userReactionsCounter: Field(reaction.userReactionsCounter),
      targetReactionsCounter: Field(reaction.targetReactionsCounter),
      reactionBlockHeight: Field(reaction.reactionBlockHeight),
      deletionBlockHeight: Field(reaction.deletionBlockHeight),
      restorationBlockHeight: Field(reaction.restorationBlockHeight)
    });
    console.log('Initial reactionsMap root: ' + context.reactionsMap.getRoot().toString());
    context.reactionsMap.set(
      Poseidon.hash([targetKey, reactorAddressAsField, reactionCodePointAsField]),
      reactionState.hash()
    );
    console.log('Latest reactionsMap root: ' + context.reactionsMap.getRoot().toString());
  });
  
  context.numberOfRections = reactions.length;
  console.log('Original number of reactions: ' + context.numberOfRections);

  return reactions;
}

// ============================================================================