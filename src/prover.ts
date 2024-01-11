import { CircuitString, PublicKey, Signature, fetchLastBlock,
  MerkleMap, Field, Poseidon, Mina, PrivateKey,
  fetchAccount, Cache, Bool } from 'o1js';
import { Config, PostState, PostsTransition, Posts,
  PostsContract, PostsProof, ReactionState,
  ReactionsTransition, Reactions, ReactionsContract,
  ReactionsProof, CommentState, CommentsTransition, Comments,
  CommentsContract, CommentsProof, Reposts, RepostsContract,
  RepostsTransition, RepostsProof, RepostState
} from 'wrdhom';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  regenerateCommentsZkAppState,
  regeneratePostsZkAppState,
  regenerateReactionsZkAppState,
  regenerateRepostsZkAppState
} from './utils/state.js';

// ============================================================================

// Set up client for PostgreSQL for structured data

const prisma = new PrismaClient();

// Load keys, and set up network and smart contract

const configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const configPosts = configJson.deployAliases['posts'];
const configReactions = configJson.deployAliases['reactions'];
const configComments = configJson.deployAliases['comments'];
const configReposts = configJson.deployAliases['reposts'];
const Network = Mina.Network(configPosts.url);
Mina.setActiveInstance(Network);
const fee = Number(configPosts.fee) * 1e9; // in nanomina (1 billion = 1.0 mina)
const feepayerKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(configPosts.feepayerKeyPath, 'utf8'));
const postsContractKeysBase58: { publicKey: string } =
  JSON.parse(await fs.readFile(configPosts.keyPath, 'utf8'));
const reactionsContractKeysBase58: { publicKey: string } =
  JSON.parse(await fs.readFile(configReactions.keyPath, 'utf8'));
const commentsContractKeysBase58: { publicKey: string } =
  JSON.parse(await fs.readFile(configComments.keyPath, 'utf8'));
const repostsContractKeysBase58: { publicKey: string } =
  JSON.parse(await fs.readFile(configReposts.keyPath, 'utf8'));
const feepayerKey = PrivateKey.fromBase58(feepayerKeysBase58.privateKey);
const feepayerAddress =   PublicKey.fromBase58(feepayerKeysBase58.publicKey);
const postsContractAddress = PublicKey.fromBase58(postsContractKeysBase58.publicKey);
const reactionsContractAddress = PublicKey.fromBase58(reactionsContractKeysBase58.publicKey);
const commentsContractAddress = PublicKey.fromBase58(commentsContractKeysBase58.publicKey);
const repostsContractAddress = PublicKey.fromBase58(repostsContractKeysBase58.publicKey);
// Fetch accounts to make sure they are available on cache during the execution of the program
await fetchAccount({ publicKey: feepayerKeysBase58.publicKey });
await fetchAccount({ publicKey: postsContractKeysBase58.publicKey });
await fetchAccount({ publicKey: reactionsContractKeysBase58.publicKey });
await fetchAccount({publicKey: commentsContractKeysBase58.publicKey});
await fetchAccount({publicKey: repostsContractKeysBase58.publicKey});
const postsContract = new PostsContract(postsContractAddress);
const reactionsContract = new ReactionsContract(reactionsContractAddress);
const commentsContract = new CommentsContract(commentsContractAddress);
const repostsContract = new RepostsContract(repostsContractAddress);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cachePath = join(__dirname, '..', '/cache/');

let startTime = performance.now();
console.log('Compiling Posts ZkProgram...');
await Posts.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling PostsContract...');
await PostsContract.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling Reactions ZkProgram...');
await Reactions.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling ReactionsContract...');
await ReactionsContract.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling Comments ZkProgram...');
await Comments.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling CommentsContract...');
await CommentsContract.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling Reposts ZkProgram...');
await Reposts.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiling RepostsContract...');
await RepostsContract.compile({cache: Cache.FileSystem(cachePath)});
console.log('Compiled');
let endTime = performance.now();
console.log(`${(endTime - startTime)/1000/60} minutes`);

// Regenerate Merkle maps from database

const usersPostsCountersMap = new MerkleMap();
const postsMap = new MerkleMap();
let numberOfPosts = 0;

const postsContext = {
  prisma: prisma,
  usersPostsCountersMap: usersPostsCountersMap,
  postsMap: postsMap,
  numberOfPosts: numberOfPosts
}

await regeneratePostsZkAppState(postsContext);

const usersReactionsCountersMap = new MerkleMap();
const targetsReactionsCountersMap =  new MerkleMap();
const reactionsMap = new MerkleMap();
let numberOfReactions = 0;

const reactionsContext = {
  prisma: prisma,
  usersReactionsCountersMap: usersReactionsCountersMap,
  targetsReactionsCountersMap: targetsReactionsCountersMap,
  reactionsMap: reactionsMap,
  numberOfReactions: numberOfReactions
}

await regenerateReactionsZkAppState(reactionsContext);

const usersCommentsCountersMap = new MerkleMap();
const targetsCommentsCountersMap =  new MerkleMap();
const commentsMap = new MerkleMap();
let numberOfComments = 0;

const commentsContext = {
  prisma: prisma,
  usersCommentsCountersMap: usersCommentsCountersMap,
  targetsCommentsCountersMap: targetsCommentsCountersMap,
  commentsMap: commentsMap,
  numberOfComments: numberOfComments
}

await regenerateCommentsZkAppState(commentsContext);

const usersRepostsCountersMap = new MerkleMap();
const targetsRepostsCountersMap =  new MerkleMap();
const repostsMap = new MerkleMap();
let numberOfReposts = 0;

const repostsContext = {
  prisma: prisma,
  usersRepostsCountersMap: usersRepostsCountersMap,
  targetsRepostsCountersMap: targetsRepostsCountersMap,
  repostsMap: repostsMap,
  numberOfReposts: numberOfReposts
}

await regenerateRepostsZkAppState(repostsContext);

const provingPosts = 0;
const provingReactions = 1;
const provingComments = 2;
const provingReposts = 3;
let provingTurn = 0;

while (true) {
  if (provingTurn === provingPosts) {
      // Process pending posts to update on-chain state

  const pendingPosts = await prisma.posts.findMany({
    take: 1,
    orderBy: {
        allPostsCounter: 'asc'
    },
    where: {
        postBlockHeight: 0
    }
    });
    postsContext.numberOfPosts += pendingPosts.length;
    console.log('Number of posts if update is successful: ' + postsContext.numberOfPosts);
    console.log('pendingPosts:');
    console.log(pendingPosts);
  
    startTime = performance.now();
  
    const lastBlock = await fetchLastBlock(configPosts.url);
    const postBlockHeight = lastBlock.blockchainLength.toBigint();
    console.log(postBlockHeight);
  
    const transitionsAndProofs: {
      transition: PostsTransition,
      proof: PostsProof
    }[] = [];
  
    for (const pPost of pendingPosts) {
      const result = await provePost(
        pPost.postSignature,
        pPost.posterAddress,
        pPost.postContentID,
        pPost.allPostsCounter,
        pPost.userPostsCounter,
        postBlockHeight,
        pPost.deletionBlockHeight,
        pPost.restorationBlockHeight
      );
  
      transitionsAndProofs.push(result);
    }
  
    if (transitionsAndProofs.length !== 0) {
      await updatePostsOnChainState(transitionsAndProofs);
  
      endTime = performance.now();
      console.log(`${(endTime - startTime)/1000/60} minutes`);
  
      let tries = 0;
      const maxTries = 50;
      let allPostsCounterFetch;
      let usersPostsCountersFetch;
      let postsFetch;
      while (tries < maxTries) {
        console.log('Pause to wait for the transaction to confirm...');
        await delay(20000);
  
        allPostsCounterFetch = await postsContract.allPostsCounter.fetch();
        console.log('allPostsCounterFetch: ' + allPostsCounterFetch?.toString());
        usersPostsCountersFetch = await postsContract.usersPostsCounters.fetch();
        console.log('usersPostsCountersFetch: ' + usersPostsCountersFetch?.toString());
        postsFetch = await postsContract.posts.fetch();
        console.log('postsFetch: ' + postsFetch?.toString());
  
        console.log(Field(postsContext.numberOfPosts).toString());
        console.log(usersPostsCountersMap.getRoot().toString());
        console.log(postsMap.getRoot().toString());
  
        console.log(allPostsCounterFetch?.equals(Field(postsContext.numberOfPosts)).toBoolean());
        console.log(usersPostsCountersFetch?.equals(usersPostsCountersMap.getRoot()).toBoolean());
        console.log(postsFetch?.equals(postsMap.getRoot()).toBoolean());
  
        if (allPostsCounterFetch?.equals(Field(postsContext.numberOfPosts)).toBoolean()
        && usersPostsCountersFetch?.equals(usersPostsCountersMap.getRoot()).toBoolean()
        && postsFetch?.equals(postsMap.getRoot()).toBoolean()) {
          for (const pPost of pendingPosts) {
            const posterAddress = PublicKey.fromBase58(pPost.posterAddress);
            const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
            const postContentID = CircuitString.fromString(pPost.postContentID);
            const postContentIDAsField = postContentID.hash();
            const postKey = Poseidon.hash([posterAddressAsField, postContentIDAsField]);
            await prisma.posts.update({
                where: {
                  postKey: postKey.toString()
                },
                data: {
                  postBlockHeight: postBlockHeight
                }
            });
          }
          tries = maxTries;
        }
        // Reset initial state if transaction appears to have failed
        if (tries === maxTries - 1) {
          postsContext.numberOfPosts -= pendingPosts.length;
          console.log('Original number of posts: ' + postsContext.numberOfPosts);
  
          const pendingPosters = new Set(pendingPosts.map( post => post.posterAddress));
          for (const poster of pendingPosters) {
            const userPosts = await prisma.posts.findMany({
              where: { posterAddress: poster,
                postBlockHeight: {
                  not: 0
                }
              },
              select: { userPostsCounter: true }
            });
            console.log(userPosts);
            console.log('Initial usersPostsCountersMap root: ' + usersPostsCountersMap.getRoot().toString());
            usersPostsCountersMap.set(
              Poseidon.hash(PublicKey.fromBase58(poster).toFields()),
              Field(userPosts.length)
            );
            console.log(userPosts.length);
            console.log('Latest usersPostsCountersMap root: ' + usersPostsCountersMap.getRoot().toString());
          };

          pendingPosts.forEach( pPost => {
            const posterAddress = PublicKey.fromBase58(pPost.posterAddress);
            const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
            const postContentID = CircuitString.fromString(pPost.postContentID);
            console.log('Initial postsMap root: ' + postsMap.getRoot().toString());
            postsMap.set(
                Poseidon.hash([posterAddressAsField, postContentID.hash()]),
                Field(0)
            );
            console.log('Latest postsMap root: ' + postsMap.getRoot().toString());
          });
        }
        tries++;
      }
    }

  } else if (provingTurn === provingReactions) {

    const pendingReactions = await prisma.reactions.findMany({
      take: 1,
      orderBy: {
          allReactionsCounter: 'asc'
      },
      where: {
          reactionBlockHeight: 0
      }
      });
      reactionsContext.numberOfReactions += pendingReactions.length;
      console.log('Number of reactions if update is successful: ' + reactionsContext.numberOfReactions);
      console.log('pendingReactions:');
      console.log(pendingReactions);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configReactions.url);
      const reactionBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(reactionBlockHeight);
    
      const transitionsAndProofs: {
        transition: ReactionsTransition,
        proof: ReactionsProof
      }[] = [];
    
      for (const pReaction of pendingReactions) {
        const result = await proveReaction(
          pReaction.isTargetPost,
          pReaction.targetKey,
          pReaction.reactorAddress,
          pReaction.reactionCodePoint,
          pReaction.allReactionsCounter,
          pReaction.userReactionsCounter,
          pReaction.targetReactionsCounter,
          reactionBlockHeight,
          pReaction.deletionBlockHeight,
          pReaction.restorationBlockHeight,
          pReaction.reactionSignature
        );
    
        transitionsAndProofs.push(result);
      }
    
      if (transitionsAndProofs.length !== 0) {
        await updateReactionsOnChainState(transitionsAndProofs);
    
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allReactionsCounterFetch;
        let userReactionsCounterFetch;
        let targetReactionsCounterFetch;
        let reactionsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allReactionsCounterFetch = await reactionsContract.allReactionsCounter.fetch();
          console.log('allReactionsCounterFetch: ' + allReactionsCounterFetch?.toString());
          userReactionsCounterFetch = await reactionsContract.usersReactionsCounters.fetch();
          console.log('userReactionsCounterFetch: ' + userReactionsCounterFetch?.toString());
          targetReactionsCounterFetch = await reactionsContract.targetsReactionsCounters.fetch();
          console.log('targetReactionsCounterFetch: ' + targetReactionsCounterFetch?.toString());
          reactionsFetch = await reactionsContract.reactions.fetch();
          console.log('reactionsFetch: ' + reactionsFetch?.toString());
    
          console.log(Field(reactionsContext.numberOfReactions).toString());
          console.log(usersReactionsCountersMap.getRoot().toString());
          console.log(targetsReactionsCountersMap.getRoot().toString());
          console.log(reactionsMap.getRoot().toString());
    
          console.log(allReactionsCounterFetch?.equals(Field(reactionsContext.numberOfReactions)).toBoolean());
          console.log(userReactionsCounterFetch?.equals(usersReactionsCountersMap.getRoot()).toBoolean());
          console.log(targetReactionsCounterFetch?.equals(targetsReactionsCountersMap.getRoot()).toBoolean());
          console.log(reactionsFetch?.equals(reactionsMap.getRoot()).toBoolean());
    
          if (allReactionsCounterFetch?.equals(Field(reactionsContext.numberOfReactions)).toBoolean()
          && userReactionsCounterFetch?.equals(usersReactionsCountersMap.getRoot()).toBoolean()
          && targetReactionsCounterFetch?.equals(targetsReactionsCountersMap.getRoot()).toBoolean()
          && reactionsFetch?.equals(reactionsMap.getRoot()).toBoolean()) {
            for (const pReaction of pendingReactions) {
              await prisma.reactions.update({
                  where: {
                    reactionKey: pReaction.reactionKey
                  },
                  data: {
                    reactionBlockHeight: reactionBlockHeight
                  }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {
            reactionsContext.numberOfReactions -= pendingReactions.length;
            console.log('Original number of reactions: ' + postsContext.numberOfPosts);
    
            const pendingReactors = new Set(pendingReactions.map( reaction => reaction.reactorAddress));
            for (const reactor of pendingReactors) {
              const userReactions = await prisma.reactions.findMany({
                where: {
                  reactorAddress: reactor,
                  reactionBlockHeight: {
                    not: 0
                  }
                }
              });
              console.log(userReactions);
              console.log('Initial usersReactionsCountersMap root: ' + usersReactionsCountersMap.getRoot().toString());
              usersReactionsCountersMap.set(
                Poseidon.hash(PublicKey.fromBase58(reactor).toFields()),
                Field(userReactions.length)
              );
              console.log(userReactions.length);
              console.log('Latest usersReactionsCountersMap root: ' + usersReactionsCountersMap.getRoot().toString());
            };

            const pendingTargets = new Set(pendingReactions.map( reaction => reaction.targetKey));
            for (const target of pendingTargets) {
              const targetReactions = await prisma.reactions.findMany({
                where: {
                  targetKey: target,
                  reactionBlockHeight: {
                    not: 0
                  }
                }
              })
              console.log('Initial targetsReactionsCountersMap root: ' + targetsReactionsCountersMap.getRoot().toString());
              targetsReactionsCountersMap.set(
                Field(target),
                Field(targetReactions.length)
              );
              console.log(targetReactions.length);
              console.log('Latest targetsReactionsCountersMap root: ' + targetsReactionsCountersMap.getRoot().toString());
            }

            pendingReactions.forEach( pReaction => {
              console.log('Initial reactionsMap root: ' + reactionsMap.getRoot().toString());
              reactionsMap.set(
                  Field(pReaction.reactionKey),
                  Field(0)
              );
              console.log('Latest reactionsMap root: ' + reactionsMap.getRoot().toString());
            });
          }
          tries++;
        }
      } else {
        console.log('Pause to wait for new actions before running loop again...');
        await delay(10000);
      }
  } else if      (provingTurn === provingComments) {

    const pendingComments = await prisma.comments.findMany({
      take: 1,
      orderBy: {
          allCommentsCounter: 'asc'
      },
      where: {
          commentBlockHeight: 0
      }
      });
      commentsContext.numberOfComments += pendingComments.length;
      console.log('Number of comments if update is successful: ' + commentsContext.numberOfComments);
      console.log('pendingComments:');
      console.log(pendingComments);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configComments.url);
      const commentBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(commentBlockHeight);
    
      const transitionsAndProofs: {
        transition: CommentsTransition,
        proof: CommentsProof
      }[] = [];
    
      for (const pComment of pendingComments) {
        const result = await proveComment(
          pComment.isTargetPost,
          pComment.targetKey,
          pComment.commenterAddress,
          pComment.commentContentID,
          pComment.allCommentsCounter,
          pComment.userCommentsCounter,
          pComment.targetCommentsCounter,
          commentBlockHeight,
          pComment.deletionBlockHeight,
          pComment.restorationBlockHeight,
          pComment.commentSignature
        );
    
        transitionsAndProofs.push(result);
      }
    
      if (transitionsAndProofs.length !== 0) {
        await updateCommentsOnChainState(transitionsAndProofs);
    
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allCommentsCounterFetch;
        let userCommentsCounterFetch;
        let targetCommentsCounterFetch;
        let commentsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allCommentsCounterFetch = await commentsContract.allCommentsCounter.fetch();
          console.log('allCommentsCounterFetch: ' + allCommentsCounterFetch?.toString());
          userCommentsCounterFetch = await commentsContract.usersCommentsCounters.fetch();
          console.log('userCommentsCounterFetch: ' + userCommentsCounterFetch?.toString());
          targetCommentsCounterFetch = await commentsContract.targetsCommentsCounters.fetch();
          console.log('targetCommentsCounterFetch: ' + targetCommentsCounterFetch?.toString());
          commentsFetch = await commentsContract.comments.fetch();
          console.log('commentsFetch: ' + commentsFetch?.toString());
    
          console.log(Field(commentsContext.numberOfComments).toString());
          console.log(usersCommentsCountersMap.getRoot().toString());
          console.log(targetsCommentsCountersMap.getRoot().toString());
          console.log(commentsMap.getRoot().toString());
    
          console.log(allCommentsCounterFetch?.equals(Field(commentsContext.numberOfComments)).toBoolean());
          console.log(userCommentsCounterFetch?.equals(usersCommentsCountersMap.getRoot()).toBoolean());
          console.log(targetCommentsCounterFetch?.equals(targetsCommentsCountersMap.getRoot()).toBoolean());
          console.log(commentsFetch?.equals(commentsMap.getRoot()).toBoolean());
    
          if (allCommentsCounterFetch?.equals(Field(commentsContext.numberOfComments)).toBoolean()
          && userCommentsCounterFetch?.equals(usersCommentsCountersMap.getRoot()).toBoolean()
          && targetCommentsCounterFetch?.equals(targetsCommentsCountersMap.getRoot()).toBoolean()
          && commentsFetch?.equals(commentsMap.getRoot()).toBoolean()) {
            for (const pComment of pendingComments) {
              await prisma.comments.update({
                  where: {
                    commentKey: pComment.commentKey
                  },
                  data: {
                    commentBlockHeight: commentBlockHeight
                  }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {
            commentsContext.numberOfComments -= pendingComments.length;
            console.log('Original number of comments: ' + postsContext.numberOfPosts);
    
            const pendingCommenters = new Set(pendingComments.map( comment => comment.commenterAddress));
            for (const commenter of pendingCommenters) {
              const userComments = await prisma.comments.findMany({
                where: {
                  commenterAddress: commenter,
                  commentBlockHeight: {
                    not: 0
                  }
                }
              });
              console.log(userComments);
              console.log('Initial usersCommentsCountersMap root: ' + usersCommentsCountersMap.getRoot().toString());
              usersCommentsCountersMap.set(
                Poseidon.hash(PublicKey.fromBase58(commenter).toFields()),
                Field(userComments.length)
              );
              console.log(userComments.length);
              console.log('Latest usersCommentsCountersMap root: ' + usersCommentsCountersMap.getRoot().toString());
            };

            const pendingTargets = new Set(pendingComments.map( comment => comment.targetKey));
            for (const target of pendingTargets) {
              const targetComments = await prisma.comments.findMany({
                where: {
                  targetKey: target,
                  commentBlockHeight: {
                    not: 0
                  }
                }
              })
              console.log('Initial targetsCommentsCountersMap root: ' + targetsCommentsCountersMap.getRoot().toString());
              targetsCommentsCountersMap.set(
                Field(target),
                Field(targetComments.length)
              );
              console.log(targetComments.length);
              console.log('Latest targetsCommentsCountersMap root: ' + targetsCommentsCountersMap.getRoot().toString());
            }

            pendingComments.forEach( pComment => {
              console.log('Initial commentsMap root: ' + commentsMap.getRoot().toString());
              commentsMap.set(
                  Field(pComment.commentKey),
                  Field(0)
              );
              console.log('Latest commentsMap root: ' + commentsMap.getRoot().toString());
            });
          }
          tries++;
        }
      } else {
        console.log('Pause to wait for new actions before running loop again...');
        await delay(10000);
      }

  } else if (provingTurn === provingReposts) {

    const pendingReposts = await prisma.reposts.findMany({
      take: 1,
      orderBy: {
          allRepostsCounter: 'asc'
      },
      where: {
          repostBlockHeight: 0
      }
      });
      repostsContext.numberOfReposts += pendingReposts.length;
      console.log('Number of reposts if update is successful: ' + repostsContext.numberOfReposts);
      console.log('pendingReposts:');
      console.log(pendingReposts);
    
      startTime = performance.now();
    
      const lastBlock = await fetchLastBlock(configReposts.url);
      const repostBlockHeight = lastBlock.blockchainLength.toBigint();
      console.log(repostBlockHeight);
    
      const transitionsAndProofs: {
        transition: RepostsTransition,
        proof: RepostsProof
      }[] = [];
    
      for (const pRepost of pendingReposts) {
        const result = await proveRepost(
          pRepost.isTargetPost,
          pRepost.targetKey,
          pRepost.reposterAddress,
          pRepost.allRepostsCounter,
          pRepost.userRepostsCounter,
          pRepost.targetRepostsCounter,
          repostBlockHeight,
          pRepost.deletionBlockHeight,
          pRepost.restorationBlockHeight,
          pRepost.repostSignature
        );
    
        transitionsAndProofs.push(result);
      }
    
      if (transitionsAndProofs.length !== 0) {
        await updateRepostsOnChainState(transitionsAndProofs);
    
        endTime = performance.now();
        console.log(`${(endTime - startTime)/1000/60} minutes`);
    
        let tries = 0;
        const maxTries = 50;
        let allRepostsCounterFetch;
        let userRepostsCounterFetch;
        let targetRepostsCounterFetch;
        let repostsFetch;
        while (tries < maxTries) {
          console.log('Pause to wait for the transaction to confirm...');
          await delay(20000);
    
          allRepostsCounterFetch = await repostsContract.allRepostsCounter.fetch();
          console.log('allRepostsCounterFetch: ' + allRepostsCounterFetch?.toString());
          userRepostsCounterFetch = await repostsContract.usersRepostsCounters.fetch();
          console.log('userRepostsCounterFetch: ' + userRepostsCounterFetch?.toString());
          targetRepostsCounterFetch = await repostsContract.targetsRepostsCounters.fetch();
          console.log('targetRepostsCounterFetch: ' + targetRepostsCounterFetch?.toString());
          repostsFetch = await repostsContract.reposts.fetch();
          console.log('repostsFetch: ' + repostsFetch?.toString());
    
          console.log(Field(repostsContext.numberOfReposts).toString());
          console.log(usersRepostsCountersMap.getRoot().toString());
          console.log(targetsRepostsCountersMap.getRoot().toString());
          console.log(repostsMap.getRoot().toString());
    
          console.log(allRepostsCounterFetch?.equals(Field(repostsContext.numberOfReposts)).toBoolean());
          console.log(userRepostsCounterFetch?.equals(usersRepostsCountersMap.getRoot()).toBoolean());
          console.log(targetRepostsCounterFetch?.equals(targetsRepostsCountersMap.getRoot()).toBoolean());
          console.log(repostsFetch?.equals(repostsMap.getRoot()).toBoolean());
    
          if (allRepostsCounterFetch?.equals(Field(repostsContext.numberOfReposts)).toBoolean()
          && userRepostsCounterFetch?.equals(usersRepostsCountersMap.getRoot()).toBoolean()
          && targetRepostsCounterFetch?.equals(targetsRepostsCountersMap.getRoot()).toBoolean()
          && repostsFetch?.equals(repostsMap.getRoot()).toBoolean()) {
            for (const pRepost of pendingReposts) {
              await prisma.reposts.update({
                  where: {
                    repostKey: pRepost.repostKey
                  },
                  data: {
                    repostBlockHeight: repostBlockHeight
                  }
              });
            }
            tries = maxTries;
          }
          // Reset initial state if transaction appears to have failed
          if (tries === maxTries - 1) {
            repostsContext.numberOfReposts -= pendingReposts.length;
            console.log('Original number of reposts: ' + postsContext.numberOfPosts);
    
            const pendingReposters = new Set(pendingReposts.map( repost => repost.reposterAddress));
            for (const reposter of pendingReposters) {
              const userReposts = await prisma.reposts.findMany({
                where: {
                  reposterAddress: reposter,
                  repostBlockHeight: {
                    not: 0
                  }
                }
              });
              console.log(userReposts);
              console.log('Initial usersRepostsCountersMap root: ' + usersRepostsCountersMap.getRoot().toString());
              usersRepostsCountersMap.set(
                Poseidon.hash(PublicKey.fromBase58(reposter).toFields()),
                Field(userReposts.length)
              );
              console.log(userReposts.length);
              console.log('Latest usersRepostsCountersMap root: ' + usersRepostsCountersMap.getRoot().toString());
            };

            const pendingTargets = new Set(pendingReposts.map( repost => repost.targetKey));
            for (const target of pendingTargets) {
              const targetReposts = await prisma.reposts.findMany({
                where: {
                  targetKey: target,
                  repostBlockHeight: {
                    not: 0
                  }
                }
              })
              console.log('Initial targetsRepostsCountersMap root: ' + targetsRepostsCountersMap.getRoot().toString());
              targetsRepostsCountersMap.set(
                Field(target),
                Field(targetReposts.length)
              );
              console.log(targetReposts.length);
              console.log('Latest targetsRepostsCountersMap root: ' + targetsRepostsCountersMap.getRoot().toString());
            }

            pendingReposts.forEach( pRepost => {
              console.log('Initial repostsMap root: ' + repostsMap.getRoot().toString());
              repostsMap.set(
                  Field(pRepost.repostKey),
                  Field(0)
              );
              console.log('Latest repostsMap root: ' + repostsMap.getRoot().toString());
            });
          }
          tries++;
        }
      } else {
        console.log('Pause to wait for new actions before running loop again...');
        await delay(10000);
      }

  }
  provingTurn++;
  if (provingTurn > provingReposts) {
    provingTurn = 0;
  }
}

// ============================================================================

async function provePost(signatureBase58: string, posterAddressBase58: string,
  postCID: string, allPostsCounter: bigint, userPostsCounter: bigint,
  postBlockHeight: bigint, deletionBlockHeight: bigint, restorationBlockHeight: bigint) {

  const signature = Signature.fromBase58(signatureBase58);
  const posterAddress = PublicKey.fromBase58(posterAddressBase58);
  const postCIDAsCircuitString = CircuitString.fromString(postCID.toString());

      const postState = new PostState({
        posterAddress: posterAddress,
        postContentID: postCIDAsCircuitString,
        allPostsCounter: Field(allPostsCounter),
        userPostsCounter: Field(userPostsCounter),
        postBlockHeight: Field(postBlockHeight),
        deletionBlockHeight: Field(deletionBlockHeight),
        restorationBlockHeight: Field(restorationBlockHeight)
      });

      const initialUsersPostsCounters = usersPostsCountersMap.getRoot();
      const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
      const userPostsCounterWitness = 
        usersPostsCountersMap.getWitness(posterAddressAsField);
      usersPostsCountersMap.set(posterAddressAsField, postState.userPostsCounter);
      const latestUsersPostsCounters = usersPostsCountersMap.getRoot();

      const initialPosts = postsMap.getRoot();
      const postKey = Poseidon.hash([posterAddressAsField, postCIDAsCircuitString.hash()]);
      const postWitness = postsMap.getWitness(postKey);
      postsMap.set(postKey, postState.hash());
      const latestPosts = postsMap.getRoot();

      const transition = PostsTransition.createPostPublishingTransition(
        signature,
        postState.allPostsCounter.sub(1),
        initialUsersPostsCounters,
        latestUsersPostsCounters,
        postState.userPostsCounter.sub(1),
        userPostsCounterWitness,
        initialPosts,
        latestPosts,
        postState,
        postWitness
      );
      console.log('Transition created');
      
      const proof = await Posts.provePostPublishingTransition(
        transition,
        signature,
        postState.allPostsCounter.sub(1),
        initialUsersPostsCounters,
        latestUsersPostsCounters,
        postState.userPostsCounter.sub(1),
        userPostsCounterWitness,
        initialPosts,
        latestPosts,
        postState,
        postWitness
      );
      console.log('Proof created');

      return {transition: transition, proof: proof};
}
  
// ============================================================================
  
  async function updatePostsOnChainState(transitionsAndProofs: {
    transition: PostsTransition,
    proof: PostsProof
  }[]) {
    let accumulatedMergedTransitions = transitionsAndProofs[0].transition;
    let accumulatedMergedProof = transitionsAndProofs[0].proof;
    for (let i = 0; i < transitionsAndProofs.length - 1; i++) {
      const currentElement = transitionsAndProofs[i+1];
  
      accumulatedMergedTransitions = PostsTransition.mergePostsTransitions(
        accumulatedMergedTransitions,
        currentElement.transition
      );
  
      console.log('initialAllPostsCounter: ' + accumulatedMergedTransitions.initialAllPostsCounter.toString());
      console.log('latestAllPostsCounter: ' + accumulatedMergedTransitions.latestAllPostsCounter.toString());
      console.log('initialUsersPostsCounters: ' + accumulatedMergedTransitions.initialUsersPostsCounters.toString());
      console.log('latestUsersPostsCounters: ' + accumulatedMergedTransitions.latestUsersPostsCounters.toString());
      console.log('initialPosts: ' + accumulatedMergedTransitions.initialPosts.toString());
      console.log('latestPosts: ' + accumulatedMergedTransitions.latestPosts.toString());
      console.log('blockHeight: ' + accumulatedMergedTransitions.blockHeight.toString());
  
      accumulatedMergedProof = await Posts.proveMergedPostsTransitions(
        accumulatedMergedTransitions,
        accumulatedMergedProof,
        currentElement.proof
      );
  
      console.log('proof.initialAllPostsCounter: ' + accumulatedMergedProof.publicInput.initialAllPostsCounter.toString());
      console.log('proof.latestAllPostsCounter: ' + accumulatedMergedProof.publicInput.latestAllPostsCounter.toString());
      console.log('proof.initialUsersPostsCounters: ' + accumulatedMergedProof.publicInput.initialUsersPostsCounters.toString());
      console.log('proof.latestUsersPostsCounters: ' + accumulatedMergedProof.publicInput.latestUsersPostsCounters.toString());
      console.log('proof.initialPosts: ' + accumulatedMergedProof.publicInput.initialPosts.toString());
      console.log('proof.latestPosts: ' + accumulatedMergedProof.publicInput.latestPosts.toString());
      console.log('proof.blockHeight: ' + accumulatedMergedProof.publicInput.blockHeight.toString());
    }
    
    let sentTxn;
    const txn = await Mina.transaction(
      { sender: feepayerAddress, fee: fee },
      () => {
        postsContract.update(accumulatedMergedProof);
      }
    );
    await txn.prove();
    sentTxn = await txn.sign([feepayerKey]).send();
  
    if (sentTxn?.hash() !== undefined) {
      console.log(`https://minascan.io/berkeley/tx/${sentTxn.hash()}`);
    }

    return sentTxn;
  }

// ============================================================================

async function proveReaction(isTargetPost: boolean, targetKey: string,
  reactorAddressBase58: string, reactionCodePoint: bigint,
  allReactionsCounter: bigint, userReactionsCounter: bigint,
  targetReactionsCounter: bigint, reactionBlockHeight: bigint,
  deletionBlockHeight: bigint, restorationBlockHeight: bigint,
  signatureBase58: string) {

  const reactorAddress = PublicKey.fromBase58(reactorAddressBase58);
  const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
  const reactionCodePointAsField = Field(reactionCodePoint);
  const targetKeyAsField = Field(targetKey);
  const signature = Signature.fromBase58(signatureBase58);

  const reactionState = new ReactionState({
    isTargetPost: Bool(isTargetPost),
    targetKey: targetKeyAsField,
    reactorAddress: reactorAddress,
    reactionCodePoint: reactionCodePointAsField,
    allReactionsCounter: Field(allReactionsCounter),
    userReactionsCounter: Field(userReactionsCounter),
    targetReactionsCounter: Field(targetReactionsCounter),
    reactionBlockHeight: Field(reactionBlockHeight),
    deletionBlockHeight: Field(deletionBlockHeight),
    restorationBlockHeight: Field(restorationBlockHeight)
  });

  const initialUsersReactionsCounters = usersReactionsCountersMap.getRoot();
  const userReactionsCounterWitness = usersReactionsCountersMap.getWitness(reactorAddressAsField);
  usersReactionsCountersMap.set(reactorAddressAsField, reactionState.userReactionsCounter);
  const latestUsersReactionsCounters = usersReactionsCountersMap.getRoot();

  const initialTargetsReactionsCounters = targetsReactionsCountersMap.getRoot();
  const targetReactionsCounterWitness = targetsReactionsCountersMap.getWitness(targetKeyAsField);
  targetsReactionsCountersMap.set(targetKeyAsField, reactionState.targetReactionsCounter);
  const latestTargetsReactionsCounters = targetsReactionsCountersMap.getRoot();

  const initialReactions = reactionsMap.getRoot();
  const reactionKey = Poseidon.hash([targetKeyAsField, reactorAddressAsField, reactionCodePointAsField]);
  const reactionWitness = reactionsMap.getWitness(reactionKey);
  reactionsMap.set(reactionKey, reactionState.hash());
  const latestReactions = reactionsMap.getRoot();

  const target = await prisma.posts.findUnique({
    where: {
      postKey: targetKey
    }
  });

  const postState = new PostState({
    posterAddress: PublicKey.fromBase58(target!.posterAddress),
    postContentID: CircuitString.fromString(target!.postContentID),
    allPostsCounter: Field(target!.allPostsCounter),
    userPostsCounter: Field(target!.userPostsCounter),
    postBlockHeight: Field(target!.postBlockHeight),
    deletionBlockHeight: Field(target!.deletionBlockHeight),
    restorationBlockHeight: Field(target!.restorationBlockHeight)
  });
  const targetWitness = postsMap.getWitness(targetKeyAsField);

  const transition = ReactionsTransition.createReactionPublishingTransition(
    signature,
    postsMap.getRoot(),
    postState,
    targetWitness,
    reactionState.allReactionsCounter.sub(1),
    initialUsersReactionsCounters,
    latestUsersReactionsCounters,
    reactionState.userReactionsCounter.sub(1),
    userReactionsCounterWitness,
    initialTargetsReactionsCounters,
    latestTargetsReactionsCounters,
    reactionState.targetReactionsCounter.sub(1),
    targetReactionsCounterWitness,
    initialReactions,
    latestReactions,
    reactionWitness,
    reactionState
  );
  console.log('Transition created');
  
  const proof = await Reactions.proveReactionPublishingTransition(
    transition,
    signature,
    postsMap.getRoot(),
    postState,
    targetWitness,
    reactionState.allReactionsCounter.sub(1),
    initialUsersReactionsCounters,
    latestUsersReactionsCounters,
    reactionState.userReactionsCounter.sub(1),
    userReactionsCounterWitness,
    initialTargetsReactionsCounters,
    latestTargetsReactionsCounters,
    reactionState.targetReactionsCounter.sub(1),
    targetReactionsCounterWitness,
    initialReactions,
    latestReactions,
    reactionWitness,
    reactionState
  );
  console.log('Proof created');

  return {transition: transition, proof: proof};
}

// ============================================================================

async function updateReactionsOnChainState(transitionsAndProofs: {
  transition: ReactionsTransition,
  proof: ReactionsProof
}[]) {
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    () => {
      reactionsContract.update(transitionsAndProofs[0].proof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn?.hash() !== undefined) {
    console.log(`https://minascan.io/berkeley/tx/${sentTxn.hash()}`);
  }

  return sentTxn;
}

// ============================================================================

async function proveComment(isTargetPost: boolean, targetKey: string,
  commenterAddressBase58: string, commentContentID: string,
  allCommentsCounter: bigint, userCommentsCounter: bigint,
  targetCommentsCounter: bigint, commentBlockHeight: bigint,
  deletionBlockHeight: bigint, restorationBlockHeight: bigint,
  signatureBase58: string) {

  const commenterAddress = PublicKey.fromBase58(commenterAddressBase58);
  const commenterAddressAsField = Poseidon.hash(commenterAddress.toFields());
  const commentContentIDAsCS = CircuitString.fromString(commentContentID);
  const commentContentIDAsField = commentContentIDAsCS.hash();
  const targetKeyAsField = Field(targetKey);
  const signature = Signature.fromBase58(signatureBase58);

  const commentState = new CommentState({
    isTargetPost: Bool(isTargetPost),
    targetKey: targetKeyAsField,
    commenterAddress: commenterAddress,
    commentContentID: commentContentIDAsCS,
    allCommentsCounter: Field(allCommentsCounter),
    userCommentsCounter: Field(userCommentsCounter),
    targetCommentsCounter: Field(targetCommentsCounter),
    commentBlockHeight: Field(commentBlockHeight),
    deletionBlockHeight: Field(deletionBlockHeight),
    restorationBlockHeight: Field(restorationBlockHeight)
  });

  const initialUsersCommentsCounters = usersCommentsCountersMap.getRoot();
  const userCommentsCounterWitness = usersCommentsCountersMap.getWitness(commenterAddressAsField);
  usersCommentsCountersMap.set(commenterAddressAsField, commentState.userCommentsCounter);
  const latestUsersCommentsCounters = usersCommentsCountersMap.getRoot();

  const initialTargetsCommentsCounters = targetsCommentsCountersMap.getRoot();
  const targetCommentsCounterWitness = targetsCommentsCountersMap.getWitness(targetKeyAsField);
  targetsCommentsCountersMap.set(targetKeyAsField, commentState.targetCommentsCounter);
  const latestTargetsCommentsCounters = targetsCommentsCountersMap.getRoot();

  const initialComments = commentsMap.getRoot();
  const commentKey = Poseidon.hash([targetKeyAsField, commenterAddressAsField, commentContentIDAsField]);
  const commentWitness = commentsMap.getWitness(commentKey);
  commentsMap.set(commentKey, commentState.hash());
  const latestComments = commentsMap.getRoot();

  const target = await prisma.posts.findUnique({
    where: {
      postKey: targetKey
    }
  });

  const postState = new PostState({
    posterAddress: PublicKey.fromBase58(target!.posterAddress),
    postContentID: CircuitString.fromString(target!.postContentID),
    allPostsCounter: Field(target!.allPostsCounter),
    userPostsCounter: Field(target!.userPostsCounter),
    postBlockHeight: Field(target!.postBlockHeight),
    deletionBlockHeight: Field(target!.deletionBlockHeight),
    restorationBlockHeight: Field(target!.restorationBlockHeight)
  });
  const targetWitness = postsMap.getWitness(targetKeyAsField);

  const transition = CommentsTransition.createCommentPublishingTransition(
    signature,
    postsMap.getRoot(),
    postState,
    targetWitness,
    commentState.allCommentsCounter.sub(1),
    initialUsersCommentsCounters,
    latestUsersCommentsCounters,
    commentState.userCommentsCounter.sub(1),
    userCommentsCounterWitness,
    initialTargetsCommentsCounters,
    latestTargetsCommentsCounters,
    commentState.targetCommentsCounter.sub(1),
    targetCommentsCounterWitness,
    initialComments,
    latestComments,
    commentWitness,
    commentState
  );
  console.log('Transition created');
  
  const proof = await Comments.proveCommentPublishingTransition(
    transition,
    signature,
    postsMap.getRoot(),
    postState,
    targetWitness,
    commentState.allCommentsCounter.sub(1),
    initialUsersCommentsCounters,
    latestUsersCommentsCounters,
    commentState.userCommentsCounter.sub(1),
    userCommentsCounterWitness,
    initialTargetsCommentsCounters,
    latestTargetsCommentsCounters,
    commentState.targetCommentsCounter.sub(1),
    targetCommentsCounterWitness,
    initialComments,
    latestComments,
    commentWitness,
    commentState
  );
  console.log('Proof created');

  return {transition: transition, proof: proof};
}

// ============================================================================

async function updateCommentsOnChainState(transitionsAndProofs: {
  transition: CommentsTransition,
  proof: CommentsProof
}[]) {
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    () => {
      commentsContract.update(transitionsAndProofs[0].proof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn?.hash() !== undefined) {
    console.log(`https://minascan.io/berkeley/tx/${sentTxn.hash()}`);
  }

  return sentTxn;
}

// ============================================================================

async function proveRepost(isTargetPost: boolean, targetKey: string,
  reposterAddressBase58: string, allRepostsCounter: bigint,
  userRepostsCounter: bigint, targetRepostsCounter: bigint,
  repostBlockHeight: bigint, deletionBlockHeight: bigint,
  restorationBlockHeight: bigint, signatureBase58: string) {

  const reposterAddress = PublicKey.fromBase58(reposterAddressBase58);
  const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());
  const targetKeyAsField = Field(targetKey);
  const signature = Signature.fromBase58(signatureBase58);

  const repostState = new RepostState({
    isTargetPost: Bool(isTargetPost),
    targetKey: targetKeyAsField,
    reposterAddress: reposterAddress,
    allRepostsCounter: Field(allRepostsCounter),
    userRepostsCounter: Field(userRepostsCounter),
    targetRepostsCounter: Field(targetRepostsCounter),
    repostBlockHeight: Field(repostBlockHeight),
    deletionBlockHeight: Field(deletionBlockHeight),
    restorationBlockHeight: Field(restorationBlockHeight)
  });

  const initialUsersRepostsCounters = usersRepostsCountersMap.getRoot();
  const userRepostsCounterWitness = usersRepostsCountersMap.getWitness(reposterAddressAsField);
  usersRepostsCountersMap.set(reposterAddressAsField, repostState.userRepostsCounter);
  const latestUsersRepostsCounters = usersRepostsCountersMap.getRoot();

  const initialTargetsRepostsCounters = targetsRepostsCountersMap.getRoot();
  const targetRepostsCounterWitness = targetsRepostsCountersMap.getWitness(targetKeyAsField);
  targetsRepostsCountersMap.set(targetKeyAsField, repostState.targetRepostsCounter);
  const latestTargetsRepostsCounters = targetsRepostsCountersMap.getRoot();

  const initialReposts = repostsMap.getRoot();
  const repostKey = Poseidon.hash([targetKeyAsField, reposterAddressAsField]);
  const repostWitness = repostsMap.getWitness(repostKey);
  repostsMap.set(repostKey, repostState.hash());
  const latestReposts = repostsMap.getRoot();

  const target = await prisma.posts.findUnique({
    where: {
      postKey: targetKey
    }
  });

  const postState = new PostState({
    posterAddress: PublicKey.fromBase58(target!.posterAddress),
    postContentID: CircuitString.fromString(target!.postContentID),
    allPostsCounter: Field(target!.allPostsCounter),
    userPostsCounter: Field(target!.userPostsCounter),
    postBlockHeight: Field(target!.postBlockHeight),
    deletionBlockHeight: Field(target!.deletionBlockHeight),
    restorationBlockHeight: Field(target!.restorationBlockHeight)
  });
  const targetWitness = postsMap.getWitness(targetKeyAsField);

  const transition = RepostsTransition.createRepostPublishingTransition(
    signature,
    postsMap.getRoot(),
    postState,
    targetWitness,
    repostState.allRepostsCounter.sub(1),
    initialUsersRepostsCounters,
    latestUsersRepostsCounters,
    repostState.userRepostsCounter.sub(1),
    userRepostsCounterWitness,
    initialTargetsRepostsCounters,
    latestTargetsRepostsCounters,
    repostState.targetRepostsCounter.sub(1),
    targetRepostsCounterWitness,
    initialReposts,
    latestReposts,
    repostWitness,
    repostState
  );
  console.log('Transition created');
  
  const proof = await Reposts.proveRepostPublishingTransition(
    transition,
    signature,
    postsMap.getRoot(),
    postState,
    targetWitness,
    repostState.allRepostsCounter.sub(1),
    initialUsersRepostsCounters,
    latestUsersRepostsCounters,
    repostState.userRepostsCounter.sub(1),
    userRepostsCounterWitness,
    initialTargetsRepostsCounters,
    latestTargetsRepostsCounters,
    repostState.targetRepostsCounter.sub(1),
    targetRepostsCounterWitness,
    initialReposts,
    latestReposts,
    repostWitness,
    repostState
  );
  console.log('Proof created');

  return {transition: transition, proof: proof};
}

// ============================================================================

async function updateRepostsOnChainState(transitionsAndProofs: {
  transition: RepostsTransition,
  proof: RepostsProof
}[]) {
  let sentTxn;
  const txn = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    () => {
      repostsContract.update(transitionsAndProofs[0].proof);
    }
  );
  await txn.prove();
  sentTxn = await txn.sign([feepayerKey]).send();

  if (sentTxn?.hash() !== undefined) {
    console.log(`https://minascan.io/berkeley/tx/${sentTxn.hash()}`);
  }

  return sentTxn;
}

// ============================================================================

  async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================