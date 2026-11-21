import json,glob,sys
pat=sys.argv[1] if len(sys.argv)>1 else 'results/*.json'
def L(x): return '-' if not x else f"{x['p50']}/{x['p95']}/{x['p99']}/{x['max']} (n={x['n']} >250:{x.get('over250','?')} >1s:{x.get('over1000','?')})"
for f in sorted(glob.glob(pat)):
  d=json.load(open(f))
  print('==',d.get('label'),'wall',d.get('wallSec'),'billing',d.get('billing'),'loop',{k:round(v,1) for k,v in d['driverLoopDelayMs'].items()})
  if 'rtt' in d: print('  rtt',L(d['rtt']),d['health']); continue
  runs=[('',d)] if 'latency' in d else list(d['full'].items())
  for name,r in runs:
    l=r['latency']; o=r['ordering']
    print(' ',name,'cast->P',L(l['castToPlayers']),'| cast->O',L(l['castToObservers']))
    print('   act->P',L(l['actToPlayers']),'| act->O',L(l['actToObservers']),'| ack',L(l['actAckToSender']),'| refused',L(l['refusedToSender']),'| join',L(l['join']))
    print('   order: reorders',o['reorders'],'missingP',o['playerFramesMissing'],'missingObsActs',o['observerActsMissing'],'thinViol',o['observerThinViolations'],'identical',o['identical'],o['actLogHashes'],'acts',o['actsInLog'],'epochs',o['epochsSeen'],'closes',o['unexpectedCloses'],'reconn',o['reconnects'],'gapRepairs',o['gapRepairs'],'conflicts',o['conflicts'])
    for k in ['run','rounds','phases','resumed','replay','exec','epochBefore','epochAfter','versionBefore','versionAfter']:
      if k in r and r[k] is not None: print('  ',k,json.dumps(r[k]))
    if 'closes' in r: print('   closes', {c['code'] for c in r['closes']}, len(r['closes']))
    s=r.get('serverStats',{}); print('   server', {k:s.get(k) for k in ['e','s','head','actsStored','msgsIn','msgsOut','dbBytes','version']})
