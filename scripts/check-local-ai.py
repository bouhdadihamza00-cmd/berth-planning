"""Live local-model smoke test using synthetic documents only; never changes the plan."""
import argparse,asyncio,io,os,sys,time,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent/'.env')
from backend.planning_ai import ai_status,interpret_document,explain_operations

async def check(args):
    if args.model:
        os.environ.update(PORTOPS_AI_PROVIDER='client_hosted',PORTOPS_AI_PROTOCOL='ollama',PORTOPS_AI_MODEL=args.model,
                          PORTOPS_AI_BASE_URL=args.endpoint,PORTOPS_AI_API_KEY='',PORTOPS_AI_TIMEOUT_SECONDS='300',
                          PORTOPS_AI_CONTEXT_TOKENS='8192',PORTOPS_AI_MAX_OUTPUT_TOKENS='4096',PORTOPS_AI_MAX_INPUT_CHARS='24000',PORTOPS_AI_VISION='true' if args.vision else 'false')
    state=ai_status()
    if not state['configured']:raise ValueError(state['message'])
    print('Testing',state['model'],'at',state['endpoint_host'],'with synthetic data only.',flush=True)
    source={'format':'csv','blocks':[{'ref':'Pilot!R2','text':'Vessel: LOCALTEST | Product: Sulfur | Quantity: 1000 tonnes'}],'tables':[],'needs_ocr':False,'truncated':False}
    context={'name':'Synthetic pilot port','timezone':'Africa/Casablanca','products':[{'product':'Sulfur','grade':'Solid sulfur','direction':'Import','subgrade':''}],'berths':[],'equipment':[]}
    started=time.monotonic()
    extracted=await interpret_document(source,context,'synthetic-pilot.csv',b'')
    print('Synthetic extraction:',json.dumps(extracted),flush=True)
    assert any(x['data'].get('name')=='LOCALTEST' and x['data'].get('quantity')==1000 for x in extracted['items']), 'The model did not faithfully extract the synthetic vessel and quantity'
    print('Text extraction passed in',round(time.monotonic()-started,1),'seconds.',flush=True)
    analysis={'metrics':{'active_calls':1},'findings':[{'id':'pilot-loader','title':'Loader has limited headroom','severity':'Medium','evidence':['Loader A is booked for 46 of the next 48 hours.'],'recommendation':'Review maintenance and recovery margin.','call_ids':[],'berth_ids':[]}]}
    started=time.monotonic()
    answer=await explain_operations(analysis,'What bottleneck is supported by these facts? Cite its finding.')
    assert 'pilot-loader' in answer['citations'],'The explanation did not cite the supplied finding'
    print('Cited operational explanation passed in',round(time.monotonic()-started,1),'seconds.',flush=True)
    print('Synthetic explanation:',answer['answer'],flush=True)
    if args.vision:
        from PIL import Image,ImageDraw,ImageFont
        image=Image.new('RGB',(640,220),'white');draw=ImageDraw.Draw(image)
        draw.multiline_text((24,32),'Vessel: VISIONTEST\nQuantity: 1000 t',fill='black',font=ImageFont.load_default(size=32),spacing=16)
        buf=io.BytesIO();image.save(buf,format='PNG');content=buf.getvalue()
        visual={'format':'image','blocks':[],'tables':[],'needs_ocr':True,'truncated':False,'warnings':[]}
        started=time.monotonic();result=await interpret_document(visual,context,'synthetic-pilot.png',content)
        assert any(x['data'].get('name')=='VISIONTEST' and x['data'].get('quantity')==1000 for x in result['items']),'The model did not faithfully read the synthetic image'
        assert all(x['issues'] for x in result['items']),'Visual-only values must remain flagged for review'
        print('Vision extraction and review safeguards passed in',round(time.monotonic()-started,1),'seconds.',flush=True)
    print('No planning data was read or changed.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--model');parser.add_argument('--endpoint',default='http://127.0.0.1:11434');parser.add_argument('--vision',action='store_true')
    asyncio.run(check(parser.parse_args()))
