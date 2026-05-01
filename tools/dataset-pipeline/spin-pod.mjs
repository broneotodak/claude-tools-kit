#!/usr/bin/env node
// Spin a RunPod on-demand pod for training. Returns pod id + SSH details.
// Pulls API key from neo-brain vault. Uses GraphQL podFindAndDeployOnDemand.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const NEO = '00000000-0000-0000-0000-000000000001';

async function getApiKey() {
  const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY);
  const { data, error } = await sb.rpc('get_credential', { p_owner_id: NEO, p_service: 'runpod', p_credential_type: 'api_key' });
  if (error) throw new Error(error.message);
  return data?.[0]?.credential_value;
}

async function gql(apiKey, query) {
  const r = await fetch('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ query })
  });
  const j = await r.json();
  if (j.errors) throw new Error('GQL: ' + JSON.stringify(j.errors));
  return j.data;
}

async function main() {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('no api key in vault');

  // Read local pubkey to inject into pod's authorized_keys via PUBLIC_KEY env
  const { readFileSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const pubkey = readFileSync(join(homedir(), '.ssh', 'id_ed25519.pub'), 'utf8').trim();

  // Spin pod (PUBLIC_KEY env triggers RunPod's entrypoint to add to ~/.ssh/authorized_keys)
  const mutation = `mutation {
    podFindAndDeployOnDemand(input: {
      cloudType: ALL,
      gpuCount: 1,
      volumeInGb: 0,
      containerDiskInGb: 50,
      minVcpuCount: 4,
      minMemoryInGb: 16,
      gpuTypeId: "NVIDIA RTX A5000",
      name: "neo-voice-train",
      imageName: "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04",
      dockerArgs: "",
      ports: "22/tcp",
      volumeMountPath: "/workspace",
      env: [{ key: "PUBLIC_KEY", value: ${JSON.stringify(pubkey)} }]
    }) {
      id
      machineId
      desiredStatus
      imageName
      machine { gpuDisplayName podHostId }
    }
  }`;

  console.log('→ Spinning pod...');
  const data = await gql(apiKey, mutation);
  const pod = data.podFindAndDeployOnDemand;
  if (!pod) throw new Error('pod creation returned null');
  console.log('  pod id     :', pod.id);
  console.log('  machine id :', pod.machineId);
  console.log('  gpu        :', pod.machine?.gpuDisplayName);
  console.log('  status     :', pod.desiredStatus);

  // Poll for runtime info (IP + SSH port)
  console.log('\n→ Waiting for pod to become reachable...');
  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const q = `{ pod(input:{podId:"${pod.id}"}) { id desiredStatus runtime { uptimeInSeconds ports { ip publicPort privatePort type } } } }`;
    const d = await gql(apiKey, q);
    const p = d.pod;
    const sshPort = p?.runtime?.ports?.find(po => po.privatePort === 22 && po.type === 'tcp');
    process.stdout.write('.');
    if (sshPort && sshPort.ip && sshPort.publicPort) {
      console.log('\n  pod ready in', Math.round((Date.now() - start) / 1000), 's');
      console.log('  ssh        : ssh root@' + sshPort.ip + ' -p ' + sshPort.publicPort + ' -i ~/.ssh/id_ed25519');
      console.log('  uptime     :', p.runtime.uptimeInSeconds, 's');
      console.log('\nPOD_ID=' + pod.id);
      console.log('SSH_HOST=' + sshPort.ip);
      console.log('SSH_PORT=' + sshPort.publicPort);
      return;
    }
  }
  console.log('\n[warn] pod did not become reachable in 5 min. id=' + pod.id);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
