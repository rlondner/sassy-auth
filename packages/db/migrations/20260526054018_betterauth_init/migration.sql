-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaApp" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isPlatform" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SaApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaOrg" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "isPlatform" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SaOrg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaUser" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "betterAuthUserId" TEXT NOT NULL,
    "orgId" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "username" TEXT,

    CONSTRAINT "SaUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaPermission" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,

    CONSTRAINT "SaPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaRole" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,

    CONSTRAINT "SaRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaRolePermission" (
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "SaRolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "SaUserRole" (
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,

    CONSTRAINT "SaUserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "SaUserPermission" (
    "userId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "SaUserPermission_pkey" PRIMARY KEY ("userId","permissionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "SaApp_publicId_key" ON "SaApp"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "SaOrg_publicId_key" ON "SaOrg"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "SaUser_publicId_key" ON "SaUser"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "SaUser_betterAuthUserId_key" ON "SaUser"("betterAuthUserId");

-- CreateIndex
CREATE INDEX "SaUser_orgId_idx" ON "SaUser"("orgId");

-- CreateIndex
CREATE INDEX "SaUser_username_idx" ON "SaUser"("username");

-- CreateIndex
CREATE INDEX "SaUser_phoneNumber_idx" ON "SaUser"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SaPermission_publicId_key" ON "SaPermission"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "SaPermission_name_key" ON "SaPermission"("name");

-- CreateIndex
CREATE INDEX "SaPermission_appId_idx" ON "SaPermission"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "SaRole_publicId_key" ON "SaRole"("publicId");

-- CreateIndex
CREATE INDEX "SaRole_appId_idx" ON "SaRole"("appId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaOrg" ADD CONSTRAINT "SaOrg_appId_fkey" FOREIGN KEY ("appId") REFERENCES "SaApp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaUser" ADD CONSTRAINT "SaUser_betterAuthUserId_fkey" FOREIGN KEY ("betterAuthUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaUser" ADD CONSTRAINT "SaUser_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "SaOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaPermission" ADD CONSTRAINT "SaPermission_appId_fkey" FOREIGN KEY ("appId") REFERENCES "SaApp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaRole" ADD CONSTRAINT "SaRole_appId_fkey" FOREIGN KEY ("appId") REFERENCES "SaApp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaRolePermission" ADD CONSTRAINT "SaRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "SaRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaRolePermission" ADD CONSTRAINT "SaRolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "SaPermission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaUserRole" ADD CONSTRAINT "SaUserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaUserRole" ADD CONSTRAINT "SaUserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "SaRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaUserPermission" ADD CONSTRAINT "SaUserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaUserPermission" ADD CONSTRAINT "SaUserPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "SaPermission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
