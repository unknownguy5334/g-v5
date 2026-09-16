import React,{useState} from 'react';
import { ModalShell } from './ModalShell';
import { fetchJson } from '../services/resilientFetch';
import { Upload, CheckCircle2, CalendarDays } from 'lucide-react';

export const OnboardingModal: React.FC<{isOpen:boolean;onClose:()=>void;onStart:()=>void}> = ({isOpen,onClose,onStart}) => {
 const [step,setStep]=useState(0); const [busy,setBusy]=useState(false);
 const finish=async()=>{try{setBusy(true);const r=await fetchJson('/api/account/onboarding/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.response.ok)throw new Error(r.data?.error||'Could not save your onboarding state.');onClose();onStart();}finally{setBusy(false);}};
 if(!isOpen)return null;
 const items=[['Welcome to Gadwal','A simple way to turn your available courses and sections into schedules you can actually compare.',''],['Add your courses','Upload screenshots or enter your courses manually. Gadwal extracts the details and gives you a chance to review them first.','upload'],['Find your schedule','Once your courses are ready, Gadwal checks the available combinations and ranks the resulting schedules for you.','calendar']];
 const [title,body,icon]=items[step];
 return <ModalShell isOpen={isOpen} onClose={()=>{if(!busy)onClose();}} title={title}><div className="py-2"><div className="w-14 h-14 rounded-2xl bg-mist flex items-center justify-center mb-5">{step===1?<Upload className="w-7 h-7"/>:step===2?<CalendarDays className="w-7 h-7"/>:<CheckCircle2 className="w-7 h-7"/>}</div><p className="text-text-secondary leading-7">{body}</p><div className="flex gap-1.5 mt-6" aria-label={`Step ${step+1} of 3`}>{items.map((_,i)=><div key={i} className={`h-1.5 flex-1 rounded-full ${i<=step?'bg-ink':'bg-line'}`}/>)}</div><div className="flex justify-between gap-3 mt-7"><button disabled={step===0||busy} onClick={()=>setStep(s=>s-1)} className="min-h-[44px] px-4 border border-line rounded-lg font-semibold disabled:opacity-40">Back</button>{step<2?<button onClick={()=>setStep(s=>s+1)} className="min-h-[44px] px-5 rounded-lg bg-ink text-white font-semibold">Next</button>:<button disabled={busy} onClick={finish} className="min-h-[44px] px-5 rounded-lg bg-accent text-white font-semibold">{busy?'Saving…':'Get started'}</button>}</div></div></ModalShell>;
};
