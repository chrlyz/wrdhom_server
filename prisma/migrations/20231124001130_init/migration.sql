-- CreateTable
CREATE TABLE "posts" (
    "posterAddress" TEXT NOT NULL,
    "postContentID" TEXT NOT NULL,
    "allPostsCounter" BIGINT NOT NULL,
    "userPostsCounter" BIGINT NOT NULL,
    "postBlockHeight" BIGINT,
    "deletionBlockHeight" BIGINT NOT NULL,
    "minaSignature" TEXT NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("posterAddress","postContentID")
);
