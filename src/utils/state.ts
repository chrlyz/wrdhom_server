import { PrismaClient } from '@prisma/client';
import { MerkleMap, Poseidon, PublicKey, CircuitString, Field, Bool } from 'o1js';
import { PostState, ReactionState, CommentState } from 'wrdhom';

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
  console.log('reactors:');
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

export async function regenerateCommentsZkAppState(context: {
  prisma: PrismaClient,
  usersCommentsCountersMap: MerkleMap,
  targetsCommentsCountersMap: MerkleMap,
  commentsMap: MerkleMap,
  numberOfComments: number
}
) {
  const comments = await context.prisma.comments.findMany({
    orderBy: {
      allCommentsCounter: 'asc'
    },
    where: {
      commentBlockHeight: {
        not: 0
      }
    }
  });
  console.log('comments:');
  console.log(comments)
  
  const commenters = new Set(comments.map( comment => comment.commenterAddress));
  console.log('commenters:');
  console.log(commenters);
  
  for (const commenter of commenters) {
    const userComments = await context.prisma.comments.findMany({
      where: {
        commenterAddress: commenter,
        commentBlockHeight: {
        not: 0
        }
      }
    });
    console.log('Initial usersCommentsCountersMap root: ' + context.usersCommentsCountersMap.getRoot().toString());
    context.usersCommentsCountersMap.set(
      Poseidon.hash(PublicKey.fromBase58(commenter).toFields()),
      Field(userComments.length)
    );
    console.log(userComments.length);
    console.log('Latest usersCommentsCountersMap root: ' + context.usersCommentsCountersMap.getRoot().toString());
  };

  const targets = new Set(comments.map( comment => comment.targetKey));
  console.log('targets');
  console.log(targets);

  for (const target of targets) {
    const targetComments = await context.prisma.comments.findMany({
      where: {
        targetKey: target,
        commentBlockHeight: {
          not: 0
        }
      }
    })
    console.log('Initial targetsCommentsCountersMap root: ' + context.targetsCommentsCountersMap.getRoot().toString());
    context.targetsCommentsCountersMap.set(
      Field(target),
      Field(targetComments.length)
    );
    console.log(targetComments.length);
    console.log('Latest targetsCommentsCountersMap root: ' + context.targetsCommentsCountersMap.getRoot().toString());
  }
  
  comments.forEach( comment => {
    const commenterAddress = PublicKey.fromBase58(comment.commenterAddress);
    const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
    const commentContentIDAsCS = CircuitString.fromString(comment.commentContentID);
    const commentContentIDAsField = commentContentIDAsCS.hash();
    const targetKey = Field(comment.targetKey);

    const commentState = new CommentState({
      isTargetPost: Bool(comment.isTargetPost),
      targetKey: targetKey,
      commenterAddress: commenterAddress,
      commentContentID: commentContentIDAsCS,
      allCommentsCounter: Field(comment.allCommentsCounter),
      userCommentsCounter: Field(comment.userCommentsCounter),
      targetCommentsCounter: Field(comment.targetCommentsCounter),
      commentBlockHeight: Field(comment.commentBlockHeight),
      deletionBlockHeight: Field(comment.deletionBlockHeight),
      restorationBlockHeight: Field(comment.restorationBlockHeight)
    });
    console.log('Initial commentsMap root: ' + context.commentsMap.getRoot().toString());
    context.commentsMap.set(
      Poseidon.hash([targetKey, commenterAddressAsField, commentContentIDAsField]),
      commentState.hash()
    );
    console.log('Latest commentsMap root: ' + context.commentsMap.getRoot().toString());
  });
  
  context.numberOfComments = comments.length;
  console.log('Original number of comments: ' + context.numberOfComments);

  return comments;
}

// ============================================================================