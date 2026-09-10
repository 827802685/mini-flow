(function(){try{var e=typeof window<`u`?window:typeof global<`u`?global:typeof globalThis<`u`?globalThis:typeof self<`u`?self:{};e.SENTRY_RELEASE={id:`n8n@2.16.2`}}catch{}})();try{(function(){var e=typeof window<`u`?window:typeof global<`u`?global:typeof globalThis<`u`?globalThis:typeof self<`u`?self:{},t=new e.Error().stack;t&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[t]=`d679f250-e08f-4cdf-aadd-e9fa20b938fc`,e._sentryDebugIdIdentifier=`sentry-dbid-d679f250-e08f-4cdf-aadd-e9fa20b938fc`)})()}catch{}import{Ft as e,Nt as t,S as n}from"./vue.runtime.esm-bundler-CN8O83h0.js";import{at as r,v as i}from"./core-peIWrpLZ.js";import{ct as a,lt as o}from"./src-CLrXPQhR.js";import{Nn as s,Pn as c,fr as l,hr as u,it as d,s as f,t as p}from"./users.store-B9YuVw3v.js";import{Fa as m,Gc as h,Qo as g,xo as _}from"./constants-j6z_fOkc.js";import{T as v}from"./useRootStore-CSv24tvl.js";import{An as y,t as b}from"./settings.store-CBjbujmj.js";import{t as x}from"./folders.store-BkuxqR-k.js";var S={name:`AI Agent workflow`,meta:{templateId:`ready-to-run-ai-workflow`},nodes:[{parameters:{url:`https://www.theverge.com/rss/index.xml`,options:{}},type:`n8n-nodes-base.rssFeedReadTool`,typeVersion:1.2,position:[128,448],id:`a26f16ce-82a5-4392-a032-622467e0098f`,name:`Get Tech News`},{parameters:{toolDescription:`Reads the news`,url:`=https://feeds.bbci.co.uk/news/world/rss.xml`,options:{}},type:`n8n-nodes-base.rssFeedReadTool`,typeVersion:1.2,position:[272,448],id:`91d1a929-b913-4399-977a-4306fe8349c7`,name:`Get World News`},{parameters:{model:{__rl:!0,mode:`list`,value:`gpt-4.1-mini`},options:{}},type:`@n8n/n8n-nodes-langchain.lmChatOpenAi`,typeVersion:1.2,position:[-144,448],id:`482c5e90-74ea-424c-9ec3-1dc14dd460f9`,name:`OpenAI Model`,notesInFlow:!0,credentials:{},notes:`Free n8n credits `},{parameters:{promptType:`define`,text:`=Provide a summary of world and tech news from the last 24 hours. 

- Use the headings "World News" and "Tech News." 
- Exclude comments, insights, and any news that is considered sad or distressing. 
- Include up to 10 concise bullet points, prioritizing major events and developments. 
- Focus on key developments from credible sources.
- Consider today to be {{ $today }}. 
`,options:{}},type:`@n8n/n8n-nodes-langchain.agent`,typeVersion:2.2,position:[-144,192],id:`62d75a96-d7de-4618-a79e-1ca945e5db3e`,name:`AI Summary Agent`,notesInFlow:!0,notes:`Double-click to open`},{parameters:{content:`✅ This demo workflow is ready to use
✨ We gave you free OpenAI credits to play with`,height:256,width:400,color:4},type:`n8n-nodes-base.stickyNote`,typeVersion:1,position:[-672,112],id:`0b71e8e9-e824-46a0-b1da-df4827ef6954`,name:`Sticky Note2`},{parameters:{subject:`Your news daily summary`,emailType:`text`,message:`={{ $json.output }}`,options:{}},type:`n8n-nodes-base.gmail`,typeVersion:2.1,position:[688,192],id:`a7f201ba-9d35-4d4e-a425-77bda8a4d2cf`,name:`Send summary with Gmail`,webhookId:`e0c46fef-51f3-4a8d-8aaf-b6e17ea89346`,notesInFlow:!0,notes:`Double-click to open`},{parameters:{content:`### ✨ Bonus step 
Send the news summary via email. Open the node and connect your Gmail account [(= new credential)](https://www.youtube.com/shorts/2K6ltfI4YRg)`,height:96,width:384,color:7},type:`n8n-nodes-base.stickyNote`,typeVersion:1,position:[544,48],id:`72b95793-9f63-4fe0-aebc-8ca0d3796e9b`,name:`Sticky Note`},{parameters:{assignments:{assignments:[{id:`85b5c530-2c13-4424-ab83-05979bc879a5`,name:`output`,value:`={{ $json.output }}`,type:`string`}]},options:{}},type:`n8n-nodes-base.set`,typeVersion:3.4,position:[256,192],id:`346ea905-9762-4349-8b8b-3cb137837fda`,name:`Output (News summary)`,notesInFlow:!0,notes:`Double-click to open`},{parameters:{},type:`n8n-nodes-base.manualTrigger`,typeVersion:1,position:[-432,192],id:`909e2605-386c-46bc-acff-97f132431d92`,name:`Workflow trigger`}],connections:{"Get Tech News":{ai_tool:[[{node:`AI Summary Agent`,type:`ai_tool`,index:0}]]},"Get World News":{ai_tool:[[{node:`AI Summary Agent`,type:`ai_tool`,index:0}]]},"OpenAI Model":{ai_languageModel:[[{node:`AI Summary Agent`,type:`ai_languageModel`,index:0}]]},"AI Summary Agent":{main:[[{node:`Output (News summary)`,type:`main`,index:0}]]},"Output (News summary)":{main:[[]]},"Workflow trigger":{main:[[{node:`AI Summary Agent`,type:`main`,index:0}]]}},pinData:{}},C=()=>{let e=a(),r=n(()=>e.params?.projectId!==void 0);return t({isOverviewSubPage:n(()=>e.params?.projectId===void 0),isSharedSubPage:n(()=>e.name===g.SHARED_WITH_ME||e.name===g.SHARED_WORKFLOWS||e.name===g.SHARED_CREDENTIALS),isProjectsSubPage:r})};function w(){let e=x(),t=C(),n=a();return{isTrulyEmpty:(r=n)=>{let i=e.workflowsCountLoaded&&e.totalWorkflowCount===0,a=!r.params?.folderId,o=t.isOverviewSubPage,s=!!r.query?.search,c=!!(r.query?.status||r.query?.tags||r.query?.showArchived||r.query?.homeProject);return i&&a&&o&&!s&&!c}}}var T={name:`Chat with the news`,meta:{templateId:`ready-to-run-ai-workflow-v5`},settings:{executionOrder:`v1`},nodes:[{parameters:{options:{}},type:`@n8n/n8n-nodes-langchain.chatTrigger`,typeVersion:1.4,position:[288,0],id:`261ee04a-4695-4d1a-bec3-9f86b5efd5eb`,name:`When chat message received`,webhookId:`b567d98b-aabb-4963-b0f8-6b1e8b5f8959`},{parameters:{model:{__rl:!0,mode:`list`,value:`gpt-4.1-mini`},responsesApiEnabled:!1,options:{}},type:`@n8n/n8n-nodes-langchain.lmChatOpenAi`,typeVersion:1.3,position:[400,288],id:`201ee441-da46-49fc-befa-312ad4b60479`,name:`OpenAI Model`,credentials:{}},{parameters:{},type:`@n8n/n8n-nodes-langchain.memoryBufferWindow`,typeVersion:1.3,position:[576,288],id:`aa874554-17b1-41a1-9e1f-8c6c197e7e2f`,name:`Simple Memory`},{parameters:{url:`https://hnrss.org/frontpage`,options:{}},type:`n8n-nodes-base.rssFeedReadTool`,typeVersion:1.2,position:[1120,288],id:`5788980c-2a63-40ed-a375-c68ca7a3b9c0`,name:`Hackernews`},{parameters:{url:`https://www.theverge.com/rss/index.xml`,options:{}},type:`n8n-nodes-base.rssFeedReadTool`,typeVersion:1.2,position:[960,288],id:`f250ef18-d913-4a76-a607-b1eeebcbab23`,name:`TheVerge`},{parameters:{url:`https://feeds.bbci.co.uk/news/rss.xml`,options:{}},type:`n8n-nodes-base.rssFeedReadTool`,typeVersion:1.2,position:[800,288],id:`0c375d2e-4b2d-4fa6-8b3e-31ac931117cb`,name:`BBC News`},{parameters:{content:`✅ This AI News agent is ready to use. Chat with it! 
✨ We gave you free OpenAI credits
💡 Learn [how to build](https://n8n.io/workflows/6270-build-your-first-ai-agent/) your own agent  `,height:80,width:448,color:4},type:`n8n-nodes-base.stickyNote`,typeVersion:1,position:[0,-176],id:`052068ba-ea50-4521-9946-63ded13b23b0`,name:`Sticky Note2`},{parameters:{options:{systemMessage:`=News Agent

# Role

You are a concise, factual news assistant with access to these RSS tools:

* BBC (Global news)
* TheVerge (Consumer tech)
* Hacker News (Tech discussions)

You always keep replies **short and focused (maximum 100 words total)**.

# Behavior

* On the first message only, greet the user and say you can search recent news.
* When the user asks for news, always check all RSS tools and combine results from multiple feeds if relevant, but surface only the **top 1 to 5 most relevant items**.
* Never invent information. Only use content found in the tools.

# Answer Format

* **Maximum 100 words per reply** (including any follow-up sentence).
* Start with **one short intro sentence**.
* Then provide **3–5 bullet points**, each a **single short sentence**.
* Use short, clear sentences.
* Add a link to the original article or source in at least one bullet.
* Include a section **“Sources checked:”** listing the feeds used (e.g., “Sources checked: BBC, TheVerge”).

# Edge Cases

* If you find too little information, say so and suggest adding more news sources to the agent.
* If the user asks you to build workflows or do non-news tasks, say you are only a news agent and point them to n8n’s AI Workflow Builder (✨ icon) and the docs: [https://docs.n8n.io/advanced-ai/ai-workflow-builder/](https://docs.n8n.io/advanced-ai/ai-workflow-builder/)
* If the user asks for opinions or predictions, stay neutral and summarize facts only.
* After sharing news results with the user for the first time, mention that they can also get AI-summarized news by email using this template: https://n8n.io/workflows/6270-build-your-first-ai-agent/. Only make this suggestion once in the entire chat history, not after every question (check your previous responses to make sure you don't repeat the suggestion).

# Date

Today is {{ $today }}
`}},type:`@n8n/n8n-nodes-langchain.agent`,typeVersion:3,position:[608,0],id:`e481d1a1-3a3d-4583-98ae-87a9b39471a8`,name:`AI Agent`}],pinData:{},connections:{"When chat message received":{main:[[{node:`AI Agent`,type:`main`,index:0}]]},"OpenAI Model":{ai_languageModel:[[{node:`AI Agent`,type:`ai_languageModel`,index:0}]]},"Simple Memory":{ai_memory:[[{node:`AI Agent`,type:`ai_memory`,index:0}]]},Hackernews:{ai_tool:[[{node:`AI Agent`,type:`ai_tool`,index:0}]]},TheVerge:{ai_tool:[[{node:`AI Agent`,type:`ai_tool`,index:0}]]},"BBC News":{ai_tool:[[{node:`AI Agent`,type:`ai_tool`,index:0}]]}}},E={name:`Chat with the news`,meta:{templateId:`ready-to-run-ai-workflow-v6`},settings:{executionOrder:`v1`},nodes:[{parameters:{options:{}},type:`@n8n/n8n-nodes-langchain.chatTrigger`,typeVersion:1.4,position:[-160,64],id:`6f4d9435-be4c-48a6-89a2-9a24cdf68d40`,name:`When chat message received`,webhookId:`b567d98b-aabb-4963-b0f8-6b1e8b5f8959`},{parameters:{model:{__rl:!0,mode:`list`,value:`gpt-4.1-mini`},responsesApiEnabled:!1,options:{}},type:`@n8n/n8n-nodes-langchain.lmChatOpenAi`,typeVersion:1.3,position:[-16,384],id:`f9b6e5c5-36d1-415f-9c5c-79fb79787207`,name:`OpenAI Model`,credentials:{}},{parameters:{},type:`@n8n/n8n-nodes-langchain.memoryBufferWindow`,typeVersion:1.3,position:[160,384],id:`81e7b833-c47b-44f7-950d-8d035fcb2205`,name:`Simple Memory`},{parameters:{url:`https://hnrss.org/frontpage`,options:{}},type:`n8n-nodes-base.rssFeedReadTool`,typeVersion:1.2,position:[432,384],id:`3677c36a-813b-407b-9fdc-38565c6f73e9`,name:`Hackernews`},{parameters:{url:`https://www.theverge.com/rss/index.xml`,options:{}},type:`n8n-nodes-base.rssFeedReadTool`,typeVersion:1.2,position:[592,384],id:`e1eaf4ea-0a02-44fd-b0c8-13505ad5bd22`,name:`TheVerge`},{parameters:{url:`https://feeds.bbci.co.uk/news/rss.xml`,options:{}},type:`n8n-nodes-base.rssFeedReadTool`,typeVersion:1.2,position:[752,384],id:`ee0b9c96-e66d-47e3-9122-0ca998caf687`,name:`BBC News`},{parameters:{content:`✅ This AI News agent is ready to use. Chat with it! 
✨ We gave you free OpenAI credits
💡 Next: [Connect a Google Sheet](https://n8n.io/workflows/7639-talk-to-your-google-sheets-using-chatgpt-5/) to chat with your data`,height:80,width:448,color:4},type:`n8n-nodes-base.stickyNote`,typeVersion:1,position:[-416,-112],id:`99944422-2269-4952-bd31-715ec0eb5bb4`,name:`Sticky Note2`},{parameters:{documentId:{__rl:!0,mode:`list`,value:``},sheetName:{__rl:!0,mode:`list`,value:``}},type:`n8n-nodes-base.googleSheetsTool`,typeVersion:4.7,position:[896,384],id:`fc10c8a7-6621-4e7d-937f-6cb1e03bc057`,name:`Google Sheets`,credentials:{}},{parameters:{options:{systemMessage:`=News Agent

# Role

You are a concise, factual news assistant with access to these RSS tools:

* BBC (Global news)
* TheVerge (Consumer tech)
* Hacker News (Tech discussions)

You always keep replies **short and focused (maximum 100 words total)**.

# Behavior

* On the first message only, greet the user and say you can search recent news.
* When the user asks for news, always check all RSS tools and combine results from multiple feeds if relevant, but surface only the **top 1 - 5 most relevant items**.
* Never invent information. Only use content found in the tools.

# Answer Format

* **Maximum 100 words per reply** (including any follow-up sentence).
* Start with **one short intro sentence**.
* Then provide **3–5 bullet points**, each a **single short sentence**.
* Use short, clear sentences.
* Add a link to the original article or source in at least one bullet.

# Edge Cases

* If you find too little information, say so and suggest adding more news sources to the agent.
* If the user asks you to build workflows or do non-news tasks, say you are only a news agent and point them to n8n’s AI Workflow Builder (✨ icon) and the docs: [https://docs.n8n.io/advanced-ai/ai-workflow-builder/](https://docs.n8n.io/advanced-ai/ai-workflow-builder/)
* If the user asks for opinions or predictions, stay neutral and summarize facts only.
* After sharing news results with the user for the first time, ask the user if they want to connect one of their Google Sheets so that they can chat with their own data. Only make this suggestion once in the entire chat history. If they say yes, provide these instructions:

1. Connect the Google Sheets node to the AI Agent in the same way as the RSS nodes.
2. Open the Google Sheets node and connect your Google account.
3. Pick your Spreadsheet and Sheet from the dropdowns.


# Date

Today is {{ $today }}
`}},type:`@n8n/n8n-nodes-langchain.agent`,typeVersion:3,position:[192,64],id:`ce5dd204-b9d3-4455-ab0c-0c2ce314ad52`,name:`AI Agent`}],pinData:{},connections:{"When chat message received":{main:[[{node:`AI Agent`,type:`main`,index:0}]]},"OpenAI Model":{ai_languageModel:[[{node:`AI Agent`,type:`ai_languageModel`,index:0}]]},"Simple Memory":{ai_memory:[[{node:`AI Agent`,type:`ai_memory`,index:0}]]},Hackernews:{ai_tool:[[{node:`AI Agent`,type:`ai_tool`,index:0}]]},TheVerge:{ai_tool:[[{node:`AI Agent`,type:`ai_tool`,index:0}]]},"BBC News":{ai_tool:[[{node:`AI Agent`,type:`ai_tool`,index:0}]]},"Google Sheets":{ai_tool:[[]]}}},D=v(y.EXPERIMENT_READY_TO_RUN_WORKFLOWS_V2,()=>{let e=u(),t=s(),r=n(()=>e.getVariant(h.name)),i=n(()=>r.value===h.variant5),a=n(()=>r.value===h.variant6),o=n(()=>t.userIsTrialing&&(i.value||a.value));return{currentVariant:r,getWorkflowForVariant:()=>{if(o.value){if(i.value)return T;if(a.value)return E}},isFeatureEnabled:o}}),O=`N8N_READY_TO_RUN_OPENAI_CREDENTIAL_ID`,k=v(y.READY_TO_RUN,()=>{let t=[`ready-to-run-ai-workflow`,`ready-to-run-ai-workflow-v5`,`ready-to-run-ai-workflow-v6`],a=l(),s=r(),u=c(),h=o(),v=d(),y=p(),x=b(),C=f(),T=D(),E=i(O,``),k=e(!1),A=n(()=>!!v.allCredentials.filter(e=>e.type===_).length),j=n(()=>!!y.currentUser?.settings?.userClaimedAiCredits),M=n(()=>x.isAiCreditsEnabled&&!A.value&&!j.value),N=e=>{a.track(`User executed ready to run AI workflow`,{status:e})},P=()=>{a.track(`User executed ready to run AI workflow successfully`)},F=async e=>{k.value=!0;try{let t=await v.claimFreeAiCredits(e);return E.value=t.id,a.track(`User claimed OpenAI credits`),t}catch(e){throw u.showError(e,s.baseText(`freeAi.credits.showError.claim.title`),s.baseText(`freeAi.credits.showError.claim.message`)),e}finally{k.value=!1}},I=()=>T.getWorkflowForVariant()??S,L=async(e,t)=>{a.track(`User opened ready to run AI workflow`,{source:e});try{let e={...I(),parentFolderId:t},n=E.value;if(n&&e.nodes){let t=m(e),r=t.nodes?.find(e=>e.name===`OpenAI Model`);r&&(r.credentials??={},r.credentials[_]={id:n,name:``}),e=t}let r=await C.createNewWorkflow(e);return await h.push({name:g.WORKFLOW,params:{name:r.id}}),r}catch(e){throw u.showError(e,s.baseText(`generic.error`)),e}},R=async(e,t,n)=>{await F(n),await L(e,t),y?.currentUser?.settings&&(y.currentUser.settings.userClaimedAiCredits=!0)},z=(e,t)=>M.value&&!t&&e,B=(e,t,n)=>M.value&&!n&&t&&e,{isTrulyEmpty:V}=w();return{claimingCredits:k,userCanClaimOpenAiCredits:M,claimFreeAiCredits:F,createAndOpenAiWorkflow:L,claimCreditsAndOpenWorkflow:R,getCardVisibility:z,getButtonVisibility:B,getSimplifiedLayoutVisibility:e=>V(e),trackExecuteAiWorkflow:N,trackExecuteAiWorkflowSuccess:P,isReadyToRunTemplateId:e=>!!e&&t.includes(e)}});export{S as i,T as n,C as r,k as t};
//# sourceMappingURL=readyToRun.store-BXJb7ZSb.js.map