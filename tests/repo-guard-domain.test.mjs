import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync,mkdirSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compareSemver,parseSemver,evaluateRussianFirstMarkdown,evaluatePackageMetadata,changedPaths } from "../scripts/repo-guard-domain.mjs";

test("exact SemVer transition semantics",()=>{
  assert.equal(compareSemver("0.5.8","0.5.7"),1);
  assert.equal(compareSemver("0.5.7","0.5.7"),0);
  assert.equal(compareSemver("0.5.6","0.5.7"),-1);
  assert.equal(compareSemver("1.0.0","1.0.0-rc.1"),1);
  assert.equal(parseSemver("01.2.3"),null);
});
test("Russian first prose ignores code and links but rejects English prose",()=>{
  assert.equal(evaluateRussianFirstMarkdown("# Лаборатория\n\nПроверяемый API.\n```js\nhello world code\n```\n").ok,true);
  assert.equal(evaluateRussianFirstMarkdown("# Laboratory\n\nEnglish-only documentation.\n").ok,false);
});
test("package + lock transaction: positive, stale mirror and missing cochange",()=>{
  const root=mkdtempSync(join(tmpdir(),"anp-domain-"));
  const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  const put=(p,c)=>writeFileSync(join(root,p),JSON.stringify(c,null,2)+"\n");
  const pkg=v=>({name:"fixture",version:v,private:true,type:"module"});
  const lock=v=>({name:"fixture",version:v,lockfileVersion:3,requires:true,packages:{"":{name:"fixture",version:v}}});
  try{
    git("init","-b","main");git("config","user.email","fixture@example.test");git("config","user.name","Fixture");
    put("package.json",pkg("0.5.7"));put("package-lock.json",lock("0.5.7"));git("add","-A");git("commit","-m","base");
    const base=git("rev-parse","HEAD");
    put("package.json",pkg("0.5.8"));put("package-lock.json",lock("0.5.8"));git("add","-A");git("commit","-m","valid");
    const good=git("rev-parse","HEAD");
    assert.equal(evaluatePackageMetadata(base,good,changedPaths(base,good,root),root).ok,true);
    put("package-lock.json",lock("0.5.7"));git("add","-A");git("commit","-m","stale lock");
    const stale=git("rev-parse","HEAD");
    assert.equal(evaluatePackageMetadata(base,stale,changedPaths(base,stale,root),root).ok,false);
    put("package.json",pkg("0.5.9"));git("add","-A");git("commit","-m","package only");
    const alone=git("rev-parse","HEAD");
    assert.equal(evaluatePackageMetadata(stale,alone,changedPaths(stale,alone,root),root).ok,false);
    // A11: metadata transaction is legitimate without inventing a version bump.
    // npm ci in the main project CI remains the authoritative dependency integrity verifier.
    put("package.json",{...pkg("0.5.9"),description:"new package description"});
    put("package-lock.json",{...lock("0.5.9"),packages:{"":{name:"fixture",version:"0.5.9",description:"new package description"}}});
    git("add","-A");git("commit","-m","consistent dependency metadata transaction");
    const consistent=git("rev-parse","HEAD");
    assert.equal(evaluatePackageMetadata(alone,consistent,changedPaths(alone,consistent,root),root).ok,true);
    put("package-lock.json",lock("0.5.8"));git("add","-A");git("commit","-m","stale lock mirror");
    const mismatch=git("rev-parse","HEAD");
    assert.equal(evaluatePackageMetadata(consistent,mismatch,changedPaths(consistent,mismatch,root),root).ok,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
