from pathlib import Path
import csv,re,statistics
root=Path(__file__).resolve().parent
p=root/'what-is-jev.html'
s=p.read_text()
def slide(title,body,notes):
 return f'<section class="slide" hidden><h2>{title}</h2>{body}<div class="notes">{notes}</div></section>'
def cols(items):
 return '<div class="points">'+''.join(f'<div><h3>{a}</h3><p>{b}</p></div>' for a,b in items)+'</div>'
# Ordinary least-squares fit of explicitly synthetic data.
xs=[1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8]
ys=[42,47,43,55,49,60,56,66,62,74,70,78,73,85,83]
xbar=statistics.mean(xs);ybar=statistics.mean(ys)
m=sum((x-xbar)*(y-ybar) for x,y in zip(xs,ys))/sum((x-xbar)**2 for x in xs);b=ybar-m*xbar
X=lambda x:90+x*72
Y=lambda y:400-(y-30)*4.6
svg='<svg viewBox="0 0 780 460" role="img" aria-label="Synthetic scatterplot of study hours and exam scores with a fitted least-squares regression line">'
for y in [40,60,80,100]:
 svg+=f'<line x1="90" y1="{Y(y)}" x2="710" y2="{Y(y)}" stroke="#d4d8cc"/><text x="70" y="{Y(y)+6}" text-anchor="end">{y}</text>'
svg+='<path d="M90 55V400H710" fill="none" stroke="#526653" stroke-width="2"/>'
for x in [0,2,4,6,8]:svg+=f'<text x="{X(x)}" y="425" text-anchor="middle">{x}</text>'
for x,y in zip(xs,ys):svg+=f'<circle cx="{X(x)}" cy="{Y(y)}" r="7" fill="#52704c"/>'
svg+=f'<line x1="{X(0)}" y1="{Y(b)}" x2="{X(8.5)}" y2="{Y(m*8.5+b)}" stroke="#b25133" stroke-width="4"/>'
svg+='<text x="400" y="455" text-anchor="middle">Hours studied</text><text transform="translate(25 240) rotate(-90)" text-anchor="middle">Exam score</text></svg>'
(root/'regression-plot.svg').write_text(svg)
new=[]
new.append(slide('Regression predicts a number',f'<div class="split"><div class="chart">{svg}</div><div><p class="answer">Learn a relationship<br>from examples.</p><p class="bodycopy">Each dot is an observation.<br>The fitted line estimates a score for a given number of study hours.</p><p class="caveat">Synthetic teaching data · least-squares fit</p></div></div>','The line is fitted to 15 synthetic observations by ordinary least squares, minimizing squared vertical errors. This is linear regression, not autoregression. A relationship in the data does not establish causation.'))
new.append(slide('Autoregression uses what came before','<p class="answer">Predict the next value from earlier values<br>in the same sequence.</p><div class="sequence"><span>Yesterday</span><span>→</span><span>Today</span><span>→</span><strong>Tomorrow?</strong></div>'+cols([('In time series','Past measurements help forecast the next measurement.'),('In language models','Earlier tokens provide context for predicting the next token.'),('In JEV','Outputs are structured decisions, produced in parallel.')]),'Classical autoregressive models regress a time series on its own lagged values. Autoregressive language generation similarly conditions each next token on preceding tokens, but is not simply a straight-line time-series model. Sources: https://otexts.com/fpp3/AR.html and https://typesafe.ai/blog/introducing-system-one-models-and-jev'))
new.append(slide('A classifier predicts a category','<div class="comparison"><div><p class="eyebrow">Regression</p><p class="answer">What number?</p><p class="bodycopy">An estimated fare: £32</p></div><div><p class="eyebrow">Classification</p><p class="answer">Which category?</p><p class="bodycopy">Survived or did not survive</p></div></div><p class="intro">A classifier can estimate class probabilities.<br>A decision rule turns those probabilities into a label.</p>','Examples are illustrative, not model outputs. Classification predicts discrete labels; regression predicts a numeric target. Logistic regression, despite its name, is commonly used for classification. Source: https://scikit-learn.org/stable/auto_examples/compose/plot_column_transformer_mixed_types.html'))
rows=list(csv.DictReader((root/'titanic.csv').open()))[:4]
table='<table><thead><tr><th>Age</th><th>Recorded sex</th><th>Ticket class</th><th class="target">Survived?</th></tr></thead><tbody>'
for r in rows:table+=f'<tr><td>{r["age"]}</td><td>{r["sex"]}</td><td>{r["pclass"]}</td><td class="target">{"Yes" if r["survived"]=="1" else "No"}</td></tr>'
table+='</tbody></table>'
new.append(slide('Titanic: learn from known outcomes','<p class="intro">One row per passenger. Passenger details are the <strong>features</strong>.<br>Survival is the <strong>label</strong> we want to predict.</p>'+table+'<p class="caveat">Four actual rows from the Seaborn Titanic dataset</p>','These are the first four records from Seaborn’s Titanic sample dataset. Features are information available before the outcome. Exclude columns such as alive, which directly reveals the label. Associations in this historical dataset are not causal explanations. Dataset: https://github.com/mwaskom/seaborn-data/blob/master/titanic.csv'))
new.append(slide('1. Prepare the data & hold some back','<p class="intro">Separate the examples used to learn from the examples used to test.</p><div class="splitbar"><span>Training data · 80%</span><span>Test data · 20%</span></div>'+cols([('Choose features','Start with age, recorded sex, and ticket class.'),('Prepare inputs','Fill missing ages and encode categories using training data only.'),('Protect the test set','Keep its outcomes hidden until the model is ready to evaluate.')]),'An 80/20 split is an illustrative choice, not a result computed for this presentation. Stratify the random split by survival to preserve class proportions. Fit preprocessing on training data only, then apply the same transformation to the test set. For model selection, use cross-validation inside the training set and reserve the test set for final evaluation. Source: https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.train_test_split.html'))
new.append(slide('2. Train a classifier','<p class="intro">For example, use <strong>logistic regression</strong>.<br>It learns how to combine features into a probability.</p><div class="sequence"><span>Passenger<br>features</span><span>→</span><span>Learned<br>weights</span><span>→</span><strong>Probability<br>of survival</strong></div>'+cols([('Predict','Make predictions on the training examples.'),('Measure error','Compare probabilities with known survival labels.'),('Adjust','Update weights to reduce the training loss.')]),'This is a conceptual training walkthrough; no model has been fitted to the Titanic data in this deck. Logistic regression applies a sigmoid to a weighted sum of features and optimizes a classification loss, typically with regularization. Despite its name, it is a classifier here. Source: https://scikit-learn.org/stable/auto_examples/compose/plot_column_transformer_mixed_types.html'))
new.append(slide('3. Test on passengers it has not seen','<p class="intro">Run the held-out features through the trained model.<br>Then compare predictions with the hidden labels.</p>'+cols([('Choose a decision rule','For illustration: predict survival when its probability is at least 0.5.'),('Count the errors','Inspect correct predictions, false positives, and false negatives.'),('Compare with a baseline','Does it beat always predicting the most common class?')])+'<p class="caveat">Good training performance alone does not show that a model generalizes.</p>','Threshold 0.5 is illustrative, not universally optimal. Choose thresholds using training/validation data based on the costs of different errors. Report held-out metrics and inspect probability calibration if probabilities will drive decisions. No accuracy result is claimed here. Source: https://scikit-learn.org/stable/auto_examples/compose/plot_column_transformer_mixed_types.html'))
new.append(slide('Back to JEV: describe the task','<div class="comparison"><div><p class="eyebrow">Task-specific classifier</p><p class="bodycopy">Collect labeled examples<br>Prepare features<br>Fit a model<br>Evaluate</p></div><div><p class="eyebrow">Pretrained decision model</p><p class="bodycopy">Provide context<br>Describe labels or a rubric<br>Call JEV<br>Evaluate</p></div></div><p class="answer"><strong>You can skip task-specific training.<br>You still need to test the decisions.</strong></p>','JEV is already trained. Its quickstart configures a new task through state, questions, and criteria rather than training a task-specific classifier. This is not a claim that JEV beats a trained classifier on Titanic. Zero-shot classification is also possible with other pretrained models. Sources: https://docs.typesafe.ai/introduction/quickstart and https://docs.typesafe.ai/introduction'))
s=s.replace('</main>', ''.join(new)+'</main>')
s=s.replace('01 / 03','01 / 11').replace('`0${index+1} / 03`','`${String(index+1).padStart(2,"0")} / ${String(slides.length).padStart(2,"0")}`')
s=s.replace("if(dialog.open||e.target.closest('button,a'))return;","if(dialog.open)return;if(e.key===' '&&e.target.closest('button,a'))return;")
s=s.replace("s.hidden=i!==index", "s.hidden=i!==index;s.setAttribute('aria-label',`Slide ${i+1} of ${slides.length}`)")
css='''.split{display:grid;grid-template-columns:1.1fr 1fr;gap:5vw;align-items:center}.chart svg{width:100%;max-height:50vh;font:18px Arial;fill:#202721}.bodycopy{font-size:clamp(22px,2.3vw,33px);line-height:1.5;margin:0 0 28px}.sequence{display:flex;align-items:center;justify-content:space-between;gap:20px;font-size:clamp(24px,3vw,42px);line-height:1.3;margin:15px 0 45px}.sequence strong{color:#52704c}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:6vw;margin-bottom:25px}.comparison>div{border-top:1px solid #aebba3;padding-top:28px}.comparison .eyebrow{margin-bottom:20px}table{border-collapse:collapse;width:100%;font-size:clamp(21px,2.3vw,32px)}th,td{text-align:left;padding:17px 24px;border-bottom:1px solid #c9cfbf}th{font-size:.7em;text-transform:uppercase;letter-spacing:.05em;color:#526653}.target{background:#e0e7cd}.splitbar{display:flex;margin:0 0 38px;font-size:clamp(18px,2vw,28px)}.splitbar span{padding:26px 20px;background:#52704c;color:#fff;width:80%}.splitbar span+span{width:20%;background:#dceb59;color:#202721}@media(max-width:700px){.split,.comparison{grid-template-columns:1fr;gap:20px}.sequence{font-size:19px;gap:10px}.splitbar span{padding:20px 10px}.chart svg{max-height:33vh}th,td{padding:12px 8px;font-size:17px}.comparison .bodycopy{font-size:21px}.comparison .eyebrow{margin-bottom:12px}.comparison>div{padding-top:15px}}'''
s=s.replace('</style>',css+'</style>')
p.write_text(s)
print(f'Created {s.count("<section")} slides; self-contained HTML: {p.stat().st_size:,} bytes')
# Check HTML structure and inline script syntax separately, without a browser.
from html.parser import HTMLParser
class Check(HTMLParser):
 def __init__(self):super().__init__();self.sections=0;self.images=0
 def handle_starttag(self,tag,attrs):
  if tag=='section':self.sections+=1
  if tag=='img':
   self.images+=1;assert dict(attrs).get('alt')
c=Check();c.feed(s);assert c.sections==11 and c.images==1
(root/'check-script.js').write_text(re.search(r'<script>(.*?)</script>',s,re.S).group(1))
