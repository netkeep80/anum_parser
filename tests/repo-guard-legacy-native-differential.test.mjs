import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { checkDomain } from "../scripts/repo-guard-domain.mjs";

// Same semantic input mutations, two genuinely executed evaluator versions.
// The historical policy and native Requirements remain distinct authorities.
const LEGACY = "679f79e8f1692bd88cdebf38c16b97950437afd2";
const legacyCli = process.env.LEGACY_REPO_GUARD_CLI;
const nativeCli = process.env.REPO_GUARD_CLI;
const enabled = Boolean(legacyCli && nativeCli);
const root = process.cwd();
const git = (cwd,...args) => execFileSync("git",args,{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"],maxBuffer:20*1024*1024}).trim();
const save = (dir,path,data) => { const target=join(dir,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data); };
const read = (dir,path) => readFileSync(join(dir,path),"utf8");
const json = (dir,path) => JSON.parse(read(dir,path));
const writeJson = (dir,path,data) => save(dir,path,JSON.stringify(data,null,2)+"\n");
const run = (cli,dir,base,head,mode) => {
  const p=spawnSync(process.execPath,[cli,"--repo-root",dir,...(mode==="legacy"?["--enforcement","blocking","check-diff"]:["check"]),"--base",base,"--head",head,"--format","json"],
    {cwd:dir,encoding:"utf8",maxBuffer:20*1024*1024});
  let report=null;
  try { report=JSON.parse(p.stdout); } catch { /* non-JSON failures remain RED */ }
  return {ok:p.status===0,code:p.status,report,stderr:p.stderr?.slice(-600),stdout:p.stdout?.slice(-600)};
};
function checkCase(label,mutate,expected,reason) {
 test("differential "+label,{skip:!enabled},()=>{
  const temp=mkdtempSync(join(tmpdir(),"anp-legacy-native-"));
  const legacy=join(temp,"legacy"),native=join(temp,"native");
  try {
   git(root,"worktree","add","-q","--detach",legacy,LEGACY);
   git(root,"worktree","add","-q","--detach",native,process.env.ANP_EXPECTED_NATIVE_HEAD);
   for(const dir of [legacy,native]) {
     git(dir,"config","user.email","differential@example.test");
     git(dir,"config","user.name","Differential Fixture");
   }
   const oldBase=git(legacy,"rev-parse","HEAD"),newBase=git(native,"rev-parse","HEAD");
   mutate(legacy,"legacy");mutate(native,"native");
   const commit=dir=>{git(dir,"add","-A");git(dir,"commit","-qm","differential "+label);return git(dir,"rev-parse","HEAD")};
   const oldHead=commit(legacy),newHead=commit(native);
   const old=run(legacyCli,legacy,oldBase,oldHead,"legacy");
   const structural=run(nativeCli,native,newBase,newHead,"native");
   const domain=checkDomain(newBase,newHead,native);
   const result={case:label,legacy:old.ok?"GREEN":"RED",native:structural.ok&&domain.ok?"GREEN":"RED",
     nativeStructural:structural.ok,nativeDomain:domain.ok,
     oldSummary:old.report?.violations?.slice(0,7).map(v=>v.rule)||old.stderr||old.stdout,
     nativeReasons:domain.reasons,nativeDiagnostics:structural.report?.diagnostics?.slice(0,6)};
   console.log("DIFFERENTIAL_CASE "+JSON.stringify(result));
   assert.equal(old.ok,expected.legacy,label+" old evaluator: "+JSON.stringify(result));
   assert.equal(structural.ok&&domain.ok,expected.native,label+" native evaluator: "+JSON.stringify(result));
   assert.equal(Boolean(reason),true);
  } finally {
   for(const dir of [native,legacy]) { try {git(root,"worktree","remove","--force",dir);}catch{} }
   rmSync(temp,{recursive:true,force:true});
  }
 });
}
const modifyBoth=(dir,fn)=>{const pkg=json(dir,"package.json"),lock=json(dir,"package-lock.json");fn(pkg,lock);writeJson(dir,"package.json",pkg);writeJson(dir,"package-lock.json",lock);};
const ver=(pkg,lock,v)=>{pkg.version=v;lock.version=v;lock.packages[""].version=v;};
const addWithOwnership=(dir,mode,path,value,hint="core")=>{
 save(dir,path,value);
 if(mode==="native") {
  const req=hint==="history"?"requirements/anum-parser/ANP-HISTORY.rg.yaml":"requirements/anum-parser/ANP-CORE.rg.yaml";
  const predicate=hint==="history"?"documents":"implemented_by";
  const escaped=path.replace(/"/g,'\\"');
  save(dir,req,read(dir,req).trimEnd()+
    "\n  - predicates: ["+predicate+"]\n    target: { kind: artifact, path: \""+escaped+"\" }\n");
 }
};
checkCase("version_advance",dir=>modifyBoth(dir,(p,l)=>ver(p,l,"0.5.8")),
 {legacy:true,native:true},"preserve accepted bump");
checkCase("package_only",dir=>{const p=json(dir,"package.json");p.version="0.5.8";writeJson(dir,"package.json",p)},
 {legacy:false,native:false},"preserve cochange");
checkCase("stale_lock_root_mirror",dir=>modifyBoth(dir,(p,l)=>{ver(p,l,"0.5.8");l.version="0.5.7"}),
 {legacy:false,native:false},"preserve lock mirror");
checkCase("stale_lock_package_mirror",dir=>modifyBoth(dir,(p,l)=>{ver(p,l,"0.5.8");l.packages[""].version="0.5.7"}),
 {legacy:false,native:false},"preserve nested lock mirror");
checkCase("semver_downgrade",dir=>modifyBoth(dir,(p,l)=>ver(p,l,"0.5.6")),
 {legacy:false,native:false},"preserve valid advance");
checkCase("readme_russian",dir=>save(dir,"README.md",read(dir,"README.md")+"\nДополнительное описание проверки.\n"),
 {legacy:true,native:true},"preserve language pass");
checkCase("readme_english",dir=>save(dir,"README.md",read(dir,"README.md")+"\nEnglish-only explanatory sentence.\n"),
 {legacy:false,native:false},"preserve language violation");
checkCase("metadata_without_version_bump",dir=>modifyBoth(dir,(p,l)=>{p.description+=" уточнение";l.packages[""].description=p.description}),
 {legacy:false,native:true},"intentional removal of unconditional bump");
checkCase("new_files_budget_21",(dir,mode)=>{
 for(let i=0;i<21;i++)addWithOwnership(dir,mode,"src/pilot-diff-"+i+".js","export const probe"+i+" = "+i+";\n");
 },{legacy:false,native:true},"intentional removal of arbitrary file count");
checkCase("new_docs_budget_4",(dir,mode)=>{
 for(let i=0;i<4;i++)addWithOwnership(dir,mode,"docs/pilot-example-"+i+".md","# Исторический пример "+i+"\n","history");
 },{legacy:false,native:true},"intentional removal of arbitrary docs count");
checkCase("line_budget_2501",dir=>save(dir,"src/carrier.js",read(dir,"src/carrier.js")+"\n".repeat(2501)),
 {legacy:false,native:true},"intentional removal of global line budget");
checkCase("historical_forbidden_path",(dir,mode)=>addWithOwnership(dir,mode,"legacy/fixture.md","# Историческое свидетельство\n","history"),
 {legacy:false,native:true},"intentional removal of housekeeping glob");
checkCase("pin_malformed",(dir,mode)=>{
 if(mode==="legacy"){
  const p=".github/workflows/repo-guard.yml";save(dir,p,read(dir,p).replace("756944656fa14de752f44bb404e1dca852f5fa6a","not-a-commit"));
 }else {
  const p=json(dir,".repo-guard/compiler-pin.json");p.sha="not-a-commit";writeJson(dir,".repo-guard/compiler-pin.json",p);
 }
},{legacy:false,native:false},"exact 40-hex SHA required");
