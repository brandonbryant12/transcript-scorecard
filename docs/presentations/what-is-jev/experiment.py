"""A fixed 100-row zero-shot JEV experiment; no dependencies or key persistence."""
from pathlib import Path
import csv,json,random,hashlib,os,urllib.request,urllib.error,time,statistics,concurrent.futures,datetime,math
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'experiment';OUT.mkdir(exist_ok=True)
MODEL='jev-1.13.0'
rows=list(csv.DictReader((ROOT/'kaggle-train.csv').open()))
assert len(rows)==891 and sum(int(r['Survived']) for r in rows)==342
rng=random.Random(20260923)
sample=rng.sample([r for r in rows if r['Survived']=='0'],62)+rng.sample([r for r in rows if r['Survived']=='1'],38)
rng.shuffle(sample)
def request_for(r):
 return {'model':MODEL,'state':{'dataset_context':'Passenger aboard RMS Titanic in 1912','passenger':{'ticket_class':int(r['Pclass']),'recorded_sex':r['Sex'],'age_years':float(r['Age']) if r['Age'] else None,'siblings_spouses_aboard':int(r['SibSp']),'parents_children_aboard':int(r['Parch']),'fare_gbp':float(r['Fare']),'embarked':r['Embarked'] or None}},'questions':{'survival':{'type':'choice','instructions':'Based only on the supplied passenger features and your general knowledge of the Titanic disaster, predict whether this passenger survived. Estimate uncertainty; do not assume a missing value is zero. Ticket class: 1=first, 2=second, 3=third. Embarked: C=Cherbourg, Q=Queenstown, S=Southampton.','criteria':{'survived':'The passenger survived the Titanic disaster.','did_not_survive':'The passenger did not survive the Titanic disaster.'}}}}
manifest={'model':MODEL,'seed':20260923,'sample_size':100,'sampling':'stratified, 62 non-survivors and 38 survivors; shuffled; no prompt tuning','source':'https://raw.githubusercontent.com/dsindy/kaggle-titanic/master/data/train.csv','dataset_sha256':hashlib.sha256((ROOT/'kaggle-train.csv').read_bytes()).hexdigest(),'passenger_ids':[int(r['PassengerId']) for r in sample],'request_template':request_for(sample[0]),'excluded':['Survived','PassengerId','Name','Ticket','Cabin'],'decision_rule':'API choice, no confidence abstention','baseline':'Always predict did_not_survive; also report female-survives heuristic','limitations':['Known public benchmark may be present in pretraining.','Only 100 rows; descriptive demonstration, not a Kaggle leaderboard result.','No task-specific model training and no prompt selection.']}
mp=OUT/'manifest.json'
if mp.exists():assert json.loads(mp.read_text())==manifest
else:mp.write_text(json.dumps(manifest,indent=2))
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise RuntimeError('API redirect rejected')
def one(r):
 dest=OUT/f'passenger-{r["PassengerId"]}.json'
 if dest.exists():return json.loads(dest.read_text())
 key=os.environ.get('JEV_API_KEY') or os.environ.get('TYPESAFE_API_KEY')
 if not key:raise RuntimeError('Set JEV_API_KEY or TYPESAFE_API_KEY to run uncached API requests.')
 request=request_for(r)
 body=json.dumps(request).encode()
 req=urllib.request.Request('https://api.typesafe.ai/v1/systemone',data=body,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='POST')
 start=time.perf_counter()
 try:
  with urllib.request.build_opener(NoRedirect()).open(req,timeout=30) as response:raw=json.load(response)
 except urllib.error.HTTPError as e:raise RuntimeError(f'API HTTP {e.code}') from None
 except Exception:raise RuntimeError('API request failed; no response persisted') from None
 elapsed=round((time.perf_counter()-start)*1000)
 assert raw['model']==MODEL
 a=raw['answers']['survival'];assert a['type']=='choice' and a['choice'] in ('survived','did_not_survive')
 probs=a['probabilities'];assert set(probs)=={'survived','did_not_survive'} and all(isinstance(v,(int,float)) and math.isfinite(v) and 0<=v<=1 for v in probs.values()) and abs(sum(probs.values())-1)<.01
 record={'passenger_id':int(r['PassengerId']),'actual':int(r['Survived']),'predicted':int(a['choice']=='survived'),'request':request,'response':raw,'elapsed_ms':elapsed,'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 dest.write_text(json.dumps(record,indent=2));return record
first=one(sample[0]);print('Preflight succeeded; pinned model verified. Continuing fixed sample.',flush=True)
records=[first]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 for record in pool.map(one,sample[1:]):
  records.append(record)
  if len(records)%20==0:print(f'Completed {len(records)}/100',flush=True)
n=len(records);cm=[[0,0],[0,0]]
for r in records:cm[r['actual']][r['predicted']]+=1
correct=cm[0][0]+cm[1][1];phat=correct/n;z=1.96;den=1+z*z/n;center=(phat+z*z/(2*n))/den;half=z*math.sqrt(phat*(1-phat)/n+z*z/(4*n*n))/den
summary={'model':MODEL,'n':n,'correct':correct,'accuracy':correct/n,'accuracy_wilson95':[center-half,center+half],'confusion_matrix_actual_rows_predicted_columns_no_yes':cm,'majority_baseline_accuracy':.62,'female_survives_baseline_accuracy':sum(int(r['Sex']=='female')==int(r['Survived']) for r in sample)/n,'brier_score':sum((r['response']['answers']['survival']['probabilities']['survived']-r['actual'])**2 for r in records)/n,'latency_median_ms':statistics.median(r['elapsed_ms'] for r in records),'latency_p95_ms':sorted(r['elapsed_ms'] for r in records)[94],'input_tokens':sum(r['response'].get('usage',{}).get('input_tokens',0) for r in records),'output_tokens':sum(r['response'].get('usage',{}).get('output_tokens',0) for r in records),'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2))
with (OUT/'predictions.csv').open('w') as f:
 w=csv.writer(f);w.writerow(['PassengerId','actual','predicted','p_survived','confidence','elapsed_ms'])
 for r in records:w.writerow([r['passenger_id'],r['actual'],r['predicted'],r['response']['answers']['survival']['probabilities']['survived'],r['response']['answers']['survival']['confidence'],r['elapsed_ms']])
print(json.dumps(summary,indent=2))
