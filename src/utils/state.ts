import { PrismaClient } from '@prisma/client';
import { MerkleMap, Poseidon, PublicKey, CircuitString, Field, Bool } from 'o1js';
import { PostState, ReactionState, CommentState, RepostState } from 'wrdhom';

// ============================================================================

export async function regeneratePostsZkAppState(context: {
    prisma: PrismaClient,
    usersPostsCountersMap: MerkleMap,
    postsMap: MerkleMap,
    totalNumberOfPosts: number,
    postsLastUpdate: number,
    postsStateHistoryMap: MerkleMap
}
) {

    let posts;
    let postsStateHistory;
    if (context.totalNumberOfPosts === 0) {

      posts = await context.prisma.posts.findMany({
        orderBy: {
          allPostsCounter: 'asc'
        },
        where: {
          postBlockHeight: {
            not: 0
          }
        }
      });

      postsStateHistory = await context.prisma.postsStateHistory.findMany({
        orderBy: {
          atBlockHeight: 'asc',
        }
      });

    } else {

      posts = await context.prisma.posts.findMany({
        orderBy: {
          allPostsCounter: 'asc'
        },
        where: {
          status: 'loading'
        }
      });

      for (const post of posts) {
        await context.prisma.posts.update({
          where: {
            postKey: post.postKey,
          },
          data: {
            status: 'loaded'
          }
        });
      }

      postsStateHistory = await context.prisma.postsStateHistory.findMany({
        orderBy: {
          atBlockHeight: 'asc',
        },
        where: {
          status: 'loading'
        }
      });

      for (const postState of postsStateHistory) {
        await context.prisma.postsStateHistory.update({
          where: {
            atBlockHeight: postState.atBlockHeight
          },
          data: {
            status: 'loaded'
          }
        });
      }
    }
    
    const posters = new Set(posts.map( post => post.posterAddress));
    for (const poster of posters) {
      const userPosts = await context.prisma.posts.findMany({
        where: { posterAddress: poster,
          postBlockHeight: {
          not: 0
          }
        }
      });
      context.usersPostsCountersMap.set(
        Poseidon.hash(PublicKey.fromBase58(poster).toFields()),
        Field(userPosts.length)
      );
    };
    
    for (const post of posts) {
      const posterAddress = PublicKey.fromBase58(post.posterAddress);
      const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
      const postContentID = CircuitString.fromString(post.postContentID);
      const userPostsCounter = Field(post.userPostsCounter);
      const postState = new PostState({
        posterAddress: posterAddress,
        postContentID: postContentID,
        allPostsCounter: Field(post.allPostsCounter),
        userPostsCounter: userPostsCounter,
        postBlockHeight: Field(post.postBlockHeight),
        deletionBlockHeight: Field(post.deletionBlockHeight),
        restorationBlockHeight: Field(post.restorationBlockHeight)
      });
      context.postsMap.set(
        Poseidon.hash([posterAddressAsField, postContentID.hash()]),
        postState.hash()
      );

      // Only update these values when the post is new
      if (post.allPostsCounter > context.totalNumberOfPosts) {
        context.totalNumberOfPosts += 1;
        context.usersPostsCountersMap.set(posterAddressAsField, userPostsCounter);
      }
    }

    const postsLastUpdateRaw = await context.prisma.postsStateHistory.aggregate({
      _max: {
        atBlockHeight: true
      }
    });
    const postsLastUpdate = postsLastUpdateRaw._max.atBlockHeight;

    if (postsLastUpdate !== null) {
      context.postsLastUpdate = Number(postsLastUpdate);

      for (const postState of postsStateHistory) {
        context.postsStateHistoryMap.set(
          Field(postState.atBlockHeight),
          Field(postState.hashedState)
        );
      }
    }

    return posts;
}

// ============================================================================

export async function regenerateReactionsZkAppState(context: {
  prisma: PrismaClient,
  usersReactionsCountersMap: MerkleMap,
  targetsReactionsCountersMap: MerkleMap,
  reactionsMap: MerkleMap,
  totalNumberOfReactions: number
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
  
  const reactors = new Set(reactions.map( reaction => reaction.reactorAddress));
  
  for (const reactor of reactors) {
    const userReactions = await context.prisma.reactions.findMany({
      where: {
        reactorAddress: reactor,
        reactionBlockHeight: {
        not: 0
        }
      }
    });
    context.usersReactionsCountersMap.set(
      Poseidon.hash(PublicKey.fromBase58(reactor).toFields()),
      Field(userReactions.length)
    );
  };

  const targets = new Set(reactions.map( reaction => reaction.targetKey));

  for (const target of targets) {
    const targetReactions = await context.prisma.reactions.findMany({
      where: {
        targetKey: target,
        reactionBlockHeight: {
          not: 0
        }
      }
    })
    context.targetsReactionsCountersMap.set(
      Field(target),
      Field(targetReactions.length)
    );
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
    context.reactionsMap.set(
      Poseidon.hash([targetKey, reactorAddressAsField, reactionCodePointAsField]),
      reactionState.hash()
    );
  });
  
  context.totalNumberOfReactions = reactions.length;

  return reactions;
}

// ============================================================================

export async function regenerateCommentsZkAppState(context: {
  prisma: PrismaClient,
  usersCommentsCountersMap: MerkleMap,
  targetsCommentsCountersMap: MerkleMap,
  commentsMap: MerkleMap,
  totalNumberOfComments: number
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
  
  const commenters = new Set(comments.map( comment => comment.commenterAddress));
  
  for (const commenter of commenters) {
    const userComments = await context.prisma.comments.findMany({
      where: {
        commenterAddress: commenter,
        commentBlockHeight: {
        not: 0
        }
      }
    });
    context.usersCommentsCountersMap.set(
      Poseidon.hash(PublicKey.fromBase58(commenter).toFields()),
      Field(userComments.length)
    );
  };

  const targets = new Set(comments.map( comment => comment.targetKey));

  for (const target of targets) {
    const targetComments = await context.prisma.comments.findMany({
      where: {
        targetKey: target,
        commentBlockHeight: {
          not: 0
        }
      }
    });
    context.targetsCommentsCountersMap.set(
      Field(target),
      Field(targetComments.length)
    );
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
    context.commentsMap.set(
      Poseidon.hash([targetKey, commenterAddressAsField, commentContentIDAsField]),
      commentState.hash()
    );
  });
  
  context.totalNumberOfComments = comments.length;

  return comments;
}

// ============================================================================

export async function regenerateRepostsZkAppState(context: {
  prisma: PrismaClient,
  usersRepostsCountersMap: MerkleMap,
  targetsRepostsCountersMap: MerkleMap,
  repostsMap: MerkleMap,
  totalNumberOfReposts: number
}
) {
  const reposts = await context.prisma.reposts.findMany({
    orderBy: {
      allRepostsCounter: 'asc'
    },
    where: {
      repostBlockHeight: {
        not: 0
      }
    }
  });
  
  const reposters = new Set(reposts.map( repost => repost.reposterAddress));
  
  for (const reposter of reposters) {
    const userReposts = await context.prisma.reposts.findMany({
      where: {
        reposterAddress: reposter,
        repostBlockHeight: {
        not: 0
        }
      }
    });
    context.usersRepostsCountersMap.set(
      Poseidon.hash(PublicKey.fromBase58(reposter).toFields()),
      Field(userReposts.length)
    );
  };

  const targets = new Set(reposts.map( repost => repost.targetKey));

  for (const target of targets) {
    const targetReposts = await context.prisma.reposts.findMany({
      where: {
        targetKey: target,
        repostBlockHeight: {
          not: 0
        }
      }
    })
    context.targetsRepostsCountersMap.set(
      Field(target),
      Field(targetReposts.length)
    );
  }
  
  reposts.forEach( repost => {
    const reposterAddress = PublicKey.fromBase58(repost.reposterAddress);
    const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());
    const targetKey = Field(repost.targetKey);
    const repostKey = Poseidon.hash([targetKey, reposterAddressAsField]);

    const repostState = new RepostState({
      isTargetPost: Bool(repost.isTargetPost),
      targetKey: targetKey,
      reposterAddress: reposterAddress,
      allRepostsCounter: Field(repost.allRepostsCounter),
      userRepostsCounter: Field(repost.userRepostsCounter),
      targetRepostsCounter: Field(repost.targetRepostsCounter),
      repostBlockHeight: Field(repost.repostBlockHeight),
      deletionBlockHeight: Field(repost.deletionBlockHeight),
      restorationBlockHeight: Field(repost.restorationBlockHeight)
    });
    context.repostsMap.set(
      repostKey,
      repostState.hash()
    );
  });
  
  context.totalNumberOfReposts = reposts.length;

  return reposts;
}

// ============================================================================

export async function  getLastPostsState(prisma: PrismaClient) {

  const postsLastUpdateBlockHeight = await prisma.postsStateHistory.aggregate({
    _max: {
      atBlockHeight: true
    }
  });

  if (postsLastUpdateBlockHeight._max.atBlockHeight !== null) {

    const lastState = await prisma.postsStateHistory.findUnique({
      where: {
        atBlockHeight: postsLastUpdateBlockHeight._max.atBlockHeight
      }
    });

    return lastState;

  } else {
    return null;
  }
}