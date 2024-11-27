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
        },
        where: {
          status: 'loaded'
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

    // Get last state update
    const postsLastUpdateRaw = await context.prisma.postsStateHistory.aggregate({
      _max: {
        atBlockHeight: true
      }
    });
    const postsLastUpdate = postsLastUpdateRaw._max.atBlockHeight;

    // If state history isn't empty, regenerate it
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
  totalNumberOfReactions: number,
  reactionsLastUpdate: number,
  reactionsStateHistoryMap: MerkleMap
}
) {

  let reactions;
  let reactionsStateHistory;
  if (context.totalNumberOfReactions === 0) {

    reactions = await context.prisma.reactions.findMany({
      orderBy: {
        allReactionsCounter: 'asc'
      },
      where: {
        reactionBlockHeight: {
          not: 0
        }
      }
    });

    reactionsStateHistory = await context.prisma.reactionsStateHistory.findMany({
      orderBy: {
        atBlockHeight: 'asc',
      },
      where: {
        status: 'loaded'
      }
    });

  } else {

    reactions = await context.prisma.reactions.findMany({
      orderBy: {
        allReactionsCounter: 'asc'
      },
      where: {
        status: 'loading'
      }
    });

    for (const reaction of reactions) {
      await context.prisma.reactions.update({
        where: {
          reactionKey: reaction.reactionKey,
        },
        data: {
          status: 'loaded'
        }
      });
    }

    reactionsStateHistory = await context.prisma.reactionsStateHistory.findMany({
      orderBy: {
        atBlockHeight: 'asc',
      },
      where: {
        status: 'loading'
      }
    });

    for (const reactionState of reactionsStateHistory) {
      await context.prisma.reactionsStateHistory.update({
        where: {
          atBlockHeight: reactionState.atBlockHeight
        },
        data: {
          status: 'loaded'
        }
      });
    }
  }
  
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
  
  for (const reaction of reactions) {
    const reactorAddress = PublicKey.fromBase58(reaction.reactorAddress);
    const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
    const reactionCodePointAsField = Field(reaction.reactionCodePoint);
    const targetKey = Field(reaction.targetKey);
    const userReactionsCounter = Field(reaction.userReactionsCounter);

    const reactionState = new ReactionState({
      isTargetPost: Bool(reaction.isTargetPost),
      targetKey: targetKey,
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePointAsField,
      allReactionsCounter: Field(reaction.allReactionsCounter),
      userReactionsCounter: userReactionsCounter,
      targetReactionsCounter: Field(reaction.targetReactionsCounter),
      reactionBlockHeight: Field(reaction.reactionBlockHeight),
      deletionBlockHeight: Field(reaction.deletionBlockHeight),
      restorationBlockHeight: Field(reaction.restorationBlockHeight)
    });
    context.reactionsMap.set(
      Poseidon.hash([targetKey, reactorAddressAsField, reactionCodePointAsField]),
      reactionState.hash()
    );

    // Only update these values when the reaction is new
    if (reaction.allReactionsCounter > context.totalNumberOfReactions) {
      context.totalNumberOfReactions += 1;
      context.usersReactionsCountersMap.set(reactorAddressAsField, userReactionsCounter);
    }
  }

  // Get last state update
  const reactionsLastUpdateRaw = await context.prisma.reactionsStateHistory.aggregate({
    _max: {
      atBlockHeight: true
    }
  });
  const reactionsLastUpdate = reactionsLastUpdateRaw._max.atBlockHeight;
  
  // If state history isn't empty, regenerate it
  if (reactionsLastUpdate !== null) {
    context.reactionsLastUpdate = Number(reactionsLastUpdate);

    for (const reactionState of reactionsStateHistory) {
      context.reactionsStateHistoryMap.set(
        Field(reactionState.atBlockHeight),
        Field(reactionState.hashedState)
      );
    }
  }

  return reactions;
}

// ============================================================================

export async function regenerateCommentsZkAppState(context: {
  prisma: PrismaClient,
  usersCommentsCountersMap: MerkleMap,
  targetsCommentsCountersMap: MerkleMap,
  commentsMap: MerkleMap,
  totalNumberOfComments: number,
  commentsLastUpdate: number,
  commentsStateHistoryMap: MerkleMap
}
) {

  let comments;
  let commentsStateHistory;
  if (context.totalNumberOfComments === 0) {

    comments = await context.prisma.comments.findMany({
      orderBy: {
        allCommentsCounter: 'asc'
      },
      where: {
        commentBlockHeight: {
          not: 0
        }
      }
    });

    commentsStateHistory = await context.prisma.commentsStateHistory.findMany({
      orderBy: {
        atBlockHeight: 'asc',
      },
      where: {
        status: 'loaded'
      }
    });

  } else {

    comments = await context.prisma.comments.findMany({
      orderBy: {
        allCommentsCounter: 'asc'
      },
      where: {
        status: 'loading'
      }
    });

    for (const comment of comments) {
      await context.prisma.comments.update({
        where: {
          commentKey: comment.commentKey,
        },
        data: {
          status: 'loaded'
        }
      });
    }

    commentsStateHistory = await context.prisma.commentsStateHistory.findMany({
      orderBy: {
        atBlockHeight: 'asc',
      },
      where: {
        status: 'loading'
      }
    });

    for (const commentState of commentsStateHistory) {
      await context.prisma.commentsStateHistory.update({
        where: {
          atBlockHeight: commentState.atBlockHeight
        },
        data: {
          status: 'loaded'
        }
      });
    }
  }
  
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
    })
    context.targetsCommentsCountersMap.set(
      Field(target),
      Field(targetComments.length)
    );
  }
  
  for (const comment of comments) {
    const commenterAddress = PublicKey.fromBase58(comment.commenterAddress);
    const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
    const commentContentIDAsCS = CircuitString.fromString(comment.commentContentID);
    const commentContentIDAsField = Field(comment.commentContentID);
    const targetKey = Field(comment.targetKey);
    const userCommentsCounter = Field(comment.userCommentsCounter);

    const commentState = new CommentState({
      isTargetPost: Bool(comment.isTargetPost),
      targetKey: targetKey,
      commenterAddress: commenterAddress,
      commentContentID: commentContentIDAsCS,
      allCommentsCounter: Field(comment.allCommentsCounter),
      userCommentsCounter: userCommentsCounter,
      targetCommentsCounter: Field(comment.targetCommentsCounter),
      commentBlockHeight: Field(comment.commentBlockHeight),
      deletionBlockHeight: Field(comment.deletionBlockHeight),
      restorationBlockHeight: Field(comment.restorationBlockHeight)
    });
    context.commentsMap.set(
      Poseidon.hash([targetKey, commenterAddressAsField, commentContentIDAsField]),
      commentState.hash()
    );

    // Only update these values when the comment is new
    if (comment.allCommentsCounter > context.totalNumberOfComments) {
      context.totalNumberOfComments += 1;
      context.usersCommentsCountersMap.set(commenterAddressAsField, userCommentsCounter);
    }
  }

  // Get last state update
  const commentsLastUpdateRaw = await context.prisma.commentsStateHistory.aggregate({
    _max: {
      atBlockHeight: true
    }
  });
  const commentsLastUpdate = commentsLastUpdateRaw._max.atBlockHeight;
  
  // If state history isn't empty, regenerate it
  if (commentsLastUpdate !== null) {
    context.commentsLastUpdate = Number(commentsLastUpdate);

    for (const commentState of commentsStateHistory) {
      context.commentsStateHistoryMap.set(
        Field(commentState.atBlockHeight),
        Field(commentState.hashedState)
      );
    }
  }

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

// ============================================================================

export async function  getLastReactionsState(prisma: PrismaClient) {

  const reactionsLastUpdateBlockHeight = await prisma.reactionsStateHistory.aggregate({
    _max: {
      atBlockHeight: true
    }
  });

  if (reactionsLastUpdateBlockHeight._max.atBlockHeight !== null) {

    const lastState = await prisma.reactionsStateHistory.findUnique({
      where: {
        atBlockHeight: reactionsLastUpdateBlockHeight._max.atBlockHeight
      }
    });

    return lastState;

  } else {
    return null;
  }
}

// ============================================================================

export async function  getLastCommentsState(prisma: PrismaClient) {

  const commentsLastUpdateBlockHeight = await prisma.commentsStateHistory.aggregate({
    _max: {
      atBlockHeight: true
    }
  });

  if (commentsLastUpdateBlockHeight._max.atBlockHeight !== null) {

    const lastState = await prisma.commentsStateHistory.findUnique({
      where: {
        atBlockHeight: commentsLastUpdateBlockHeight._max.atBlockHeight
      }
    });

    return lastState;

  } else {
    return null;
  }
}

// ============================================================================