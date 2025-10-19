/**
 * COMPREHENSIVE STORAGE INTEGRATION TESTS
 * These tests validate real S3/R2 storage operations with actual credentials
 * They WILL FAIL if storage is not properly configured
 * They WILL CONSUME STORAGE COSTS when run with real credentials
 */

import type { IAgentRuntime } from '@elizaos/core';

export const StorageIntegrationTestSuite = {
  name: 'StorageIntegrationTestSuite',
  tests: [
    {
      name: 'storage_configuration_validation',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🔥 REAL TEST: Storage configuration validation');

        const service = runtime.getService('elizaos-services');
        if (!service) {
          throw new Error('ElizaOS Services service not found - plugin not loaded correctly');
        }

        const storage = (service as any).getStorage();
        if (!storage) {
          throw new Error('Storage service not available - service initialization failed');
        }

        // Verify required configuration
        const requiredEnvVars = [
          'ELIZAOS_STORAGE_ENDPOINT',
          'ELIZAOS_STORAGE_BUCKET',
          'ELIZAOS_STORAGE_ACCESS_KEY',
          'ELIZAOS_STORAGE_SECRET_KEY',
        ];

        const missingVars = requiredEnvVars.filter(
          (varName) => !process.env[varName] || process.env[varName]!.length === 0
        );

        if (missingVars.length > 0) {
          throw new Error(
            `Storage configuration incomplete. Missing: ${missingVars.join(', ')}. ` +
              'Set these environment variables to run storage integration tests.'
          );
        }

        console.log('✅ Storage configuration validation passed');
      },
    },

    {
      name: 'storage_upload_download_cycle',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🔥 REAL TEST: Storage upload/download cycle');

        const service = runtime.getService('elizaos-services');
        const storage = (service as any).getStorage();

        const testKey = `integration-test/${Date.now()}-upload-download.txt`;
        const originalData = Buffer.from(
          `Integration test data - ${new Date().toISOString()}\nMulti-line content\nwith special chars: éñ中文🚀`
        );

        try {
          // Test upload
          console.log(`🔄 Uploading test file: ${testKey}`);
          const uploadResult = await storage.uploadFile(testKey, originalData, 'text/plain');

          if (uploadResult !== testKey) {
            throw new Error(
              `Upload returned unexpected key: expected "${testKey}", got "${uploadResult}"`
            );
          }

          console.log('✅ Upload successful');

          // Test file existence immediately after upload
          const exists = await storage.fileExists(testKey);
          if (!exists) {
            throw new Error('File existence check failed immediately after upload');
          }

          console.log('✅ File existence confirmed');

          // Test metadata retrieval
          const metadata = await storage.getFileMetadata(testKey);
          if (!metadata) {
            throw new Error('Failed to retrieve file metadata');
          }

          if (metadata.size !== originalData.length) {
            throw new Error(`Size mismatch: expected ${originalData.length}, got ${metadata.size}`);
          }

          if (metadata.contentType !== 'text/plain') {
            throw new Error(
              `Content type mismatch: expected "text/plain", got "${metadata.contentType}"`
            );
          }

          console.log(
            `✅ Metadata validation passed: ${metadata.size} bytes, ${metadata.contentType}`
          );

          // Test download
          console.log('🔄 Downloading file for verification');
          const downloadedData = await storage.downloadFile(testKey);

          if (!downloadedData.equals(originalData)) {
            throw new Error('Downloaded data does not match uploaded data');
          }

          console.log('✅ Download and data integrity verification passed');

          // Cleanup
          await storage.deleteFile(testKey);
          console.log('✅ File cleanup completed');

          // Verify deletion
          const existsAfterDelete = await storage.fileExists(testKey);
          if (existsAfterDelete) {
            throw new Error('File still exists after deletion');
          }

          console.log('✅ Deletion verification passed');
          console.log('✅ REAL STORAGE UPLOAD/DOWNLOAD CYCLE SUCCESS');
        } catch (error) {
          // Cleanup on error
          try {
            await storage.deleteFile(testKey);
          } catch (cleanupError) {
            console.warn('Failed to cleanup test file on error:', cleanupError);
          }
          throw error;
        }
      },
    },

    {
      name: 'storage_signed_url_generation',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🔥 REAL TEST: Storage signed URL generation');

        const service = runtime.getService('elizaos-services');
        const storage = (service as any).getStorage();

        const testKey = `integration-test/${Date.now()}-signed-url.txt`;
        const testData = Buffer.from('Signed URL test data');

        try {
          // Upload test file
          await storage.uploadFile(testKey, testData, 'text/plain');

          // Test GET signed URL
          const getUrl = await storage.getSignedUrl(testKey, 'get', 300);
          if (!getUrl.startsWith('http')) {
            throw new Error(`Invalid GET signed URL: ${getUrl}`);
          }

          // URL should contain necessary components
          if (!getUrl.includes(testKey) || !getUrl.includes('X-Amz-Signature')) {
            throw new Error('GET signed URL missing required components');
          }

          console.log('✅ GET signed URL generation passed');

          // Test PUT signed URL
          const putKey = `integration-test/${Date.now()}-signed-put.txt`;
          const putUrl = await storage.getSignedUrl(putKey, 'put', 300);
          if (!putUrl.startsWith('http')) {
            throw new Error(`Invalid PUT signed URL: ${putUrl}`);
          }

          if (!putUrl.includes(putKey) || !putUrl.includes('X-Amz-Signature')) {
            throw new Error('PUT signed URL missing required components');
          }

          console.log('✅ PUT signed URL generation passed');

          // Test different expiration times
          const shortUrl = await storage.getSignedUrl(testKey, 'get', 60);
          const longUrl = await storage.getSignedUrl(testKey, 'get', 3600);

          if (shortUrl === longUrl) {
            throw new Error('Signed URLs with different expiration times should differ');
          }

          console.log('✅ Expiration time handling passed');
          console.log('✅ REAL STORAGE SIGNED URL GENERATION SUCCESS');

          // Cleanup
          await storage.deleteFile(testKey);
        } catch (error) {
          // Cleanup on error
          try {
            await storage.deleteFile(testKey);
          } catch (cleanupError) {
            console.warn('Failed to cleanup test file on error:', cleanupError);
          }
          throw error;
        }
      },
    },

    {
      name: 'storage_list_operations',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🔥 REAL TEST: Storage list operations');

        const service = runtime.getService('elizaos-services');
        const storage = (service as any).getStorage();

        const testPrefix = `integration-test/list-test-${Date.now()}`;
        const testFiles = [
          `${testPrefix}/file1.txt`,
          `${testPrefix}/file2.txt`,
          `${testPrefix}/subdir/file3.txt`,
        ];

        try {
          // Upload multiple test files
          for (const filePath of testFiles) {
            const data = Buffer.from(`Content for ${filePath}`);
            await storage.uploadFile(filePath, data, 'text/plain');
          }

          console.log(`✅ Uploaded ${testFiles.length} test files`);

          // Test listing with prefix
          const listedFiles = await storage.listFiles(testPrefix);

          if (listedFiles.length < testFiles.length) {
            throw new Error(
              `Expected at least ${testFiles.length} files, got ${listedFiles.length}`
            );
          }

          // Verify all uploaded files are in the list
          for (const testFile of testFiles) {
            if (!listedFiles.includes(testFile)) {
              throw new Error(`File ${testFile} not found in list results`);
            }
          }

          console.log('✅ Prefix-based file listing passed');

          // Test listing with more specific prefix
          const subdirFiles = await storage.listFiles(`${testPrefix}/subdir/`);
          const expectedSubdirFile = `${testPrefix}/subdir/file3.txt`;

          if (!subdirFiles.includes(expectedSubdirFile)) {
            throw new Error('Subdirectory listing failed');
          }

          console.log('✅ Subdirectory listing passed');

          // Test listing with max keys limit
          const limitedFiles = await storage.listFiles(testPrefix, 2);
          if (limitedFiles.length > 2) {
            throw new Error(`Max keys limit not respected: got ${limitedFiles.length} files`);
          }

          console.log('✅ Max keys limit handling passed');
          console.log('✅ REAL STORAGE LIST OPERATIONS SUCCESS');

          // Cleanup all test files
          for (const filePath of testFiles) {
            await storage.deleteFile(filePath);
          }

          console.log('✅ Test files cleanup completed');
        } catch (error) {
          // Cleanup on error
          try {
            for (const filePath of testFiles) {
              await storage.deleteFile(filePath);
            }
          } catch (cleanupError) {
            console.warn('Failed to cleanup test files on error:', cleanupError);
          }
          throw error;
        }
      },
    },

    {
      name: 'storage_error_handling',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🔥 REAL TEST: Storage error handling');

        const service = runtime.getService('elizaos-services');
        const storage = (service as any).getStorage();

        // Test download of non-existent file
        const nonExistentKey = `integration-test/non-existent-${Date.now()}.txt`;

        try {
          await storage.downloadFile(nonExistentKey);
          throw new Error('Download of non-existent file should have failed');
        } catch (error) {
          if (error instanceof Error && !error.message.includes('failed')) {
            throw new Error('Download error should contain meaningful message');
          }
          console.log('✅ Non-existent file download error handling passed');
        }

        // Test file existence for non-existent file
        const exists = await storage.fileExists(nonExistentKey);
        if (exists) {
          throw new Error('Non-existent file should not report as existing');
        }

        console.log('✅ Non-existent file existence check passed');

        // Test metadata for non-existent file
        const metadata = await storage.getFileMetadata(nonExistentKey);
        if (metadata !== null) {
          throw new Error('Non-existent file should return null metadata');
        }

        console.log('✅ Non-existent file metadata handling passed');

        // Test deletion of non-existent file (should not throw)
        try {
          await storage.deleteFile(nonExistentKey);
          console.log('✅ Non-existent file deletion handling passed');
        } catch (error) {
          // Some storage systems may throw on delete of non-existent file
          console.log('⚠️  Storage throws on non-existent file deletion (acceptable behavior)');
        }

        console.log('✅ REAL STORAGE ERROR HANDLING SUCCESS');
      },
    },

    {
      name: 'storage_large_file_handling',
      fn: async (runtime: IAgentRuntime) => {
        console.log('🔥 REAL TEST: Storage large file handling');

        const service = runtime.getService('elizaos-services');
        const storage = (service as any).getStorage();

        // Test with 1MB file
        const largeSizeBytes = 1024 * 1024; // 1MB
        const testKey = `integration-test/${Date.now()}-large-file.bin`;

        // Create large buffer with known pattern
        const largeData = Buffer.alloc(largeSizeBytes);
        for (let i = 0; i < largeSizeBytes; i++) {
          largeData[i] = i % 256;
        }

        try {
          console.log(`🔄 Uploading large file: ${largeSizeBytes} bytes`);

          const startTime = Date.now();
          await storage.uploadFile(testKey, largeData, 'application/octet-stream');
          const uploadTime = Date.now() - startTime;

          console.log(`✅ Large file upload completed in ${uploadTime}ms`);

          // Verify file metadata
          const metadata = await storage.getFileMetadata(testKey);
          if (!metadata || metadata.size !== largeSizeBytes) {
            throw new Error(`Size mismatch: expected ${largeSizeBytes}, got ${metadata?.size}`);
          }

          console.log('✅ Large file metadata validation passed');

          // Test download
          console.log('🔄 Downloading large file for verification');
          const downloadStartTime = Date.now();
          const downloadedData = await storage.downloadFile(testKey);
          const downloadTime = Date.now() - downloadStartTime;

          console.log(`✅ Large file download completed in ${downloadTime}ms`);

          // Verify data integrity
          if (!downloadedData.equals(largeData)) {
            throw new Error('Large file data integrity check failed');
          }

          console.log('✅ Large file data integrity verification passed');
          console.log('✅ REAL STORAGE LARGE FILE HANDLING SUCCESS');

          // Cleanup
          await storage.deleteFile(testKey);
        } catch (error) {
          // Cleanup on error
          try {
            await storage.deleteFile(testKey);
          } catch (cleanupError) {
            console.warn('Failed to cleanup large test file on error:', cleanupError);
          }
          throw error;
        }
      },
    },
  ],
};
