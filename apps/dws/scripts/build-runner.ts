/**
 * Build script for Jeju CI Runner images (ARM64 + AMD64)
 */

const REGISTRY = process.env.JEJU_REGISTRY_URL || 'ghcr.io/jeju-labs';
const IMAGE_NAME = 'jeju-runner';
const VERSION = process.env.VERSION || 'latest';

async function buildRunner(): Promise<void> {
  const dockerDir = new URL('../docker', import.meta.url).pathname;

  console.log('Building Jeju CI Runner images...');
  console.log(`Registry: ${REGISTRY}`);
  console.log(`Version: ${VERSION}`);

  const buildxCreate = Bun.spawn(['docker', 'buildx', 'create', '--use', '--name', 'jeju-builder'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await buildxCreate.exited;

  const buildxInspect = Bun.spawn(['docker', 'buildx', 'inspect', '--bootstrap'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await buildxInspect.exited;

  const push = process.argv.includes('--push');
  const platforms = 'linux/amd64,linux/arm64';

  const buildArgs = [
    'docker',
    'buildx',
    'build',
    '--platform',
    platforms,
    '-f',
    `${dockerDir}/Dockerfile.runner`,
    '-t',
    `${REGISTRY}/${IMAGE_NAME}:${VERSION}`,
    '-t',
    `${REGISTRY}/${IMAGE_NAME}:latest`,
  ];

  if (push) {
    buildArgs.push('--push');
  } else {
    buildArgs.push('--load');
    buildArgs.splice(buildArgs.indexOf('--platform'), 2);
    buildArgs.push('--platform', 'linux/' + (process.arch === 'arm64' ? 'arm64' : 'amd64'));
  }

  buildArgs.push(dockerDir);

  console.log(`\nBuilding: ${buildArgs.join(' ')}`);

  const build = Bun.spawn(buildArgs, {
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await build.exited;

  if (exitCode !== 0) {
    console.error('Build failed');
    process.exit(1);
  }

  console.log('\nBuild successful.');

  if (push) {
    console.log(`\nImages pushed:`);
    console.log(`  ${REGISTRY}/${IMAGE_NAME}:${VERSION}`);
    console.log(`  ${REGISTRY}/${IMAGE_NAME}:latest`);
  } else {
    console.log(`\nImage loaded locally:`);
    console.log(`  ${REGISTRY}/${IMAGE_NAME}:latest`);
  }

  console.log('\nTo test the runner locally:');
  console.log(`  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \\`);
  console.log(`    -e JEJU_WORKFLOW=$(echo '{"runId":"test","jobId":"build","job":{"steps":[{"run":"echo hello"}]}}' | base64) \\`);
  console.log(`    ${REGISTRY}/${IMAGE_NAME}:latest`);
}

buildRunner().catch(console.error);


