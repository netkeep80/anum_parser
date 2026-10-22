import assert from "node:assert/strict";
import { spawnSync,execFileSync } from "node:child_process";
import { mkdtempSync,mkdirSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname,join } from "node:path";
import { test } from "node:test";

const cli=process.env.REPO_GUARD_CLI;
function fixture(){
 const root=mkdtempSync(join(tmpdir(),"anp-native-"));
 const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 const put=(p,s)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s)};
 const req=(relations)=>["format: repo-guard/requirement-v1","id: ANP-T",
   "normative: \"Fixture must preserve externally visible source behavior.\"","relations:",...relations,""].join("\n");
 const links=[
  "  - predicates: [implemented_by]",'    target: { kind: artifact, path: "value.txt" }',
  "  - predicates: [verified_by]",'    target: { kind: artifact, path: "tests/smoke.test.mjs" }',
 ];
 git("init","-b","main");git("config","user.email","fixture@example.test");git("config","user.name","Fixture");
 put("requirements/demo/ANP-T.rg.yaml",req(links));put("value.txt","v1\n");put("tests/smoke.test.mjs","export const smoke=true;\n");
 git("add","-A");git("commit","-m","native base");
 const base=git("rev-parse","HEAD");
 const commit=(message)=>{git("add","-A");git("commit","-m",message);return git("rev-parse","HEAD")};
 const run=(b,h)=>{const p=spawnSync(process.execPath,[cli,"--repo-root",root,"check","--base",b,"--head",h,"--format","json"],{encoding:"utf8"});
   return {status:p.status,report:JSON.parse(p.stdout),error:p.stderr};};
 return {root,git,put,req,links,base,commit,run};
}

test("native J1/J2/J3: ordinary change, orphan and fake verifier", {skip:!cli},()=>{
 const f=fixture();try{
   let a=f.run(f.base,f.base);assert.equal(a.status,0,JSON.stringify(a));assert.equal(a.report.j1.tracked,3);assert.equal(a.report.j2.rooted,1);
   f.put("value.txt","v2\n");const good=f.commit("ordinary change");a=f.run(f.base,good);assert.equal(a.status,0,JSON.stringify(a));assert.ok(a.report.j3.changed>0);
   f.put("rogue.txt","unjustified\n");const orphan=f.commit("orphan");a=f.run(good,orphan);assert.notEqual(a.status,0);
   f.git("rm","rogue.txt");const clean=f.commit("remove orphan");
   f.put("requirements/demo/ANP-T.rg.yaml",f.req([
    "  - predicates: [implemented_by]",'    target: { kind: artifact, path: "value.txt" }',
    "  - predicates: [verified_by]",'    target: { kind: artifact, path: "tests/missing.test.mjs" }',
   ]));const missing=f.commit("fake verifier");a=f.run(clean,missing);assert.notEqual(a.status,0);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test("duplicate RequirementId and closed self-root fail", {skip:!cli},()=>{
 const f=fixture();try{
   f.put("requirements/demo/ALIAS.rg.yaml",f.req(f.links));const duplicate=f.commit("duplicate");
   let a=f.run(f.base,duplicate);assert.notEqual(a.status,0);
   f.git("rm","requirements/demo/ALIAS.rg.yaml");
   f.put("requirements/demo/ANP-T.rg.yaml",f.req([
     "  - predicates: [derives_from]",'    target: { kind: requirement, id: "ANP-T" }',
     ...f.links,
   ]));const cycle=f.commit("self root");a=f.run(f.base,cycle);assert.notEqual(a.status,0);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test("native-to-arbitrary-legacy rollback rejected", {skip:!cli},()=>{
 const f=fixture();try{
   f.git("rm","requirements/demo/ANP-T.rg.yaml");const legacy=f.commit("unapproved rollback");
   const a=f.run(f.base,legacy);assert.notEqual(a.status,0);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});

test("A2/A3: unrooted child, missing provenance and duplicate IDs fail", {skip:!cli},()=>{
 const f=fixture();try{
   f.put("requirements/demo/ANP-CHILD.rg.yaml",[
     "format: repo-guard/requirement-v1","id: ANP-CHILD",
     'normative: "A distinct checkable child obligation."',"relations:",
     "  - predicates: [derives_from]",
     '    target: { kind: requirement, id: "ANP-MISSING" }',""
   ].join("\n"));
   const child=f.commit("unrooted child");let a=f.run(f.base,child);
   assert.notEqual(a.status,0);assert.equal(a.report.j2.head,false);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test("A9/A16: explicit Requirement text transition in ordinary native BASE-to-HEAD", {skip:!cli},()=>{
 const f=fixture();try{
  f.put("requirements/demo/ANP-T.rg.yaml",f.req(f.links).replace("externally visible","externally verifiable"));
  const head=f.commit("accepted normative change candidate");
  const r=f.run(f.base,head);
  assert.equal(r.status,0,JSON.stringify(r));
  assert.equal(r.report.j3.changed>0,true);
  assert.equal(r.report.j3.ok,true);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test("A13: legacy global new-file budgets are intentionally absent", {skip:!cli},()=>{
 const f=fixture();try{
  const more=[];
  for(let i=0;i<22;i++){const path="src/added-"+i+".txt";f.put(path,"justified\n");
    more.push("  - predicates: [implemented_by]",'    target: { kind: artifact, path: "'+path+'" }');
  }
  f.put("requirements/demo/ANP-T.rg.yaml",f.req([...f.links,...more]));
  const head=f.commit("many justified files without arbitrary budget");
  const r=f.run(f.base,head);assert.equal(r.status,0,JSON.stringify(r));
  assert.equal(r.report.j1.tracked,25);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test("A6: existing verifier link is not evidence of executed test; delegated to CI", {skip:!cli},()=>{
 const f=fixture();try{
   // A vacuous verifier file is structurally linked, but compiler is not an interpreter of evidence.
   f.put("tests/smoke.test.mjs","process.exit(0);\n");
   const head=f.commit("vacuous verifier file");
   const r=f.run(f.base,head);
   assert.equal(r.status,0,JSON.stringify(r)); // Known epistemic boundary, not an A6 proof.
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
test("A8: nonexistent/stale revision fails instead of silently shifting BASE", {skip:!cli},()=>{
 const f=fixture();try{
   const p=spawnSync(process.execPath,[cli,"--repo-root",f.root,"check","--base","f".repeat(40),"--head",f.base,"--format","json"],{encoding:"utf8"});
   assert.notEqual(p.status,0);
 }finally{rmSync(f.root,{recursive:true,force:true})}
});
