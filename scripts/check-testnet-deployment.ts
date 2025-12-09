#!/usr/bin/env bun
/**
 * Check Testnet Deployment Status
 * 
 * Checks the status of AWS infrastructure and provides next steps.
 * 
 * Usage: bun run scripts/check-testnet-deployment.ts
 */

import { $ } from 'bun';

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║             Jeju Testnet Deployment Status Check                     ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  // Check DNS nameservers
  console.log('🌐 Checking DNS Configuration...\n');
  
  const dnsResult = await $`dig NS jeju.network +short`.quiet().nothrow();
  const currentNS = dnsResult.stdout.toString().trim().split('\n');
  
  const awsNS = [
    'ns-604.awsdns-11.net.',
    'ns-1788.awsdns-31.co.uk.',
    'ns-1165.awsdns-17.org.',
    'ns-66.awsdns-08.com.'
  ];
  
  const isUsingAWSNS = currentNS.some(ns => ns.includes('awsdns'));
  
  if (isUsingAWSNS) {
    console.log('✅ DNS: Nameservers pointing to AWS Route53');
  } else {
    console.log('❌ DNS: Nameservers NOT pointing to AWS Route53');
    console.log(`   Current: ${currentNS.join(', ')}`);
    console.log(`   Expected: ${awsNS.join(', ')}`);
    console.log('\n   ACTION: Update nameservers at your domain registrar\n');
  }

  // Check ACM certificate status
  console.log('🔒 Checking ACM Certificate...\n');
  
  const certResult = await $`aws acm list-certificates --region us-east-1 --query "CertificateSummaryList[?DomainName=='jeju.network']" --output json`.quiet().nothrow();
  
  if (certResult.exitCode === 0) {
    const certs = JSON.parse(certResult.stdout.toString());
    if (certs.length > 0) {
      const cert = certs[0];
      const status = cert.Status;
      
      if (status === 'ISSUED') {
        console.log(`✅ ACM Certificate: ISSUED (${cert.CertificateArn.slice(-20)}...)`);
      } else if (status === 'PENDING_VALIDATION') {
        console.log(`⏳ ACM Certificate: PENDING_VALIDATION`);
        console.log('   Waiting for DNS validation...');
        if (!isUsingAWSNS) {
          console.log('   Certificate will validate after nameservers are updated.');
        }
      } else {
        console.log(`⚠️ ACM Certificate: ${status}`);
      }
    }
  }

  // Check EKS cluster
  console.log('\n☸️ Checking EKS Cluster...\n');
  
  const eksResult = await $`aws eks describe-cluster --name jeju-testnet --region us-east-1 --query "cluster.status" --output text`.quiet().nothrow();
  
  if (eksResult.exitCode === 0) {
    const status = eksResult.stdout.toString().trim();
    if (status === 'ACTIVE') {
      console.log('✅ EKS Cluster: ACTIVE');
      
      // Check nodes
      const nodesResult = await $`aws eks list-nodegroups --cluster-name jeju-testnet --region us-east-1 --query "nodegroups" --output json`.quiet().nothrow();
      if (nodesResult.exitCode === 0) {
        const nodes = JSON.parse(nodesResult.stdout.toString());
        console.log(`   Node Groups: ${nodes.join(', ')}`);
      }
    } else {
      console.log(`⏳ EKS Cluster: ${status}`);
    }
  } else {
    console.log('❌ EKS Cluster: Not found or not accessible');
  }

  // Check RDS
  console.log('\n🗄️ Checking RDS Database...\n');
  
  const rdsResult = await $`aws rds describe-db-instances --db-instance-identifier jeju-testnet-postgres --region us-east-1 --query "DBInstances[0].DBInstanceStatus" --output text`.quiet().nothrow();
  
  if (rdsResult.exitCode === 0) {
    const status = rdsResult.stdout.toString().trim();
    if (status === 'available') {
      console.log('✅ RDS Database: available');
    } else {
      console.log(`⏳ RDS Database: ${status}`);
    }
  } else {
    console.log('⏳ RDS Database: Creating or not found');
  }

  // Check ALB
  console.log('\n🔄 Checking Application Load Balancer...\n');
  
  const albResult = await $`aws elbv2 describe-load-balancers --names jeju-testnet-alb --region us-east-1 --query "LoadBalancers[0].State.Code" --output text`.quiet().nothrow();
  
  if (albResult.exitCode === 0) {
    const status = albResult.stdout.toString().trim();
    if (status === 'active') {
      console.log('✅ ALB: active');
      
      // Get DNS name
      const dnsResult = await $`aws elbv2 describe-load-balancers --names jeju-testnet-alb --region us-east-1 --query "LoadBalancers[0].DNSName" --output text`.quiet().nothrow();
      if (dnsResult.exitCode === 0) {
        console.log(`   DNS: ${dnsResult.stdout.toString().trim()}`);
      }
    } else {
      console.log(`⏳ ALB: ${status}`);
    }
  } else {
    console.log('❌ ALB: Not found');
  }

  // Summary
  console.log(`
═══════════════════════════════════════════════════════════════════════

📋 Summary:

${isUsingAWSNS ? '✅' : '❌'} DNS Nameservers
${eksResult.stdout?.toString().trim() === 'ACTIVE' ? '✅' : '⏳'} EKS Cluster
${rdsResult.stdout?.toString().trim() === 'available' ? '✅' : '⏳'} RDS Database
${albResult.stdout?.toString().trim() === 'active' ? '✅' : '⏳'} Load Balancer

═══════════════════════════════════════════════════════════════════════
`);

  if (!isUsingAWSNS) {
    console.log(`
⚠️ BLOCKING ISSUE: Domain nameservers need to be updated

Update nameservers at your domain registrar to:
  ns-604.awsdns-11.net
  ns-1788.awsdns-31.co.uk
  ns-1165.awsdns-17.org
  ns-66.awsdns-08.com

After updating, run this script again to check status.
`);
  } else {
    console.log(`
Next Steps:
  1. Configure kubectl: aws eks update-kubeconfig --name jeju-testnet --region us-east-1
  2. Deploy apps: cd packages/deployment && NETWORK=testnet bun run scripts/helmfile.ts sync
  3. Deploy contracts: bun run scripts/deploy/oif-multichain.ts --all
`);
  }
}

main().catch(console.error);


