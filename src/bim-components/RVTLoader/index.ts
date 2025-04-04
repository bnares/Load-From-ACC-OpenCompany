import * as OBC from "@thatopen/components"
import { CircleGeometry } from "three";
import * as FRAGS from "@thatopen/fragments"

type requestedParameter = "code" | "grant_type" | "redirect_url";

export interface FileResource{
  url: string,
  cookie1:string,
  cookie2: string,
  cookie3: string
}

export class RVTLoader extends OBC.Component{
  enabled: boolean = false;

  static readonly uuid = OBC.UUID.create();

  private clientID: string = import.meta.env.VITE_CLIENT_ID;
  private clientSecret: string = import.meta.env.VITE_CLIENT_SECRET;
  private _accessToken : string | undefined; 

  // An event to load the model into the world
	// This is triggered in the getFileContent method
	// And the function to trigger is added in the main file
  onProcessingFinished: OBC.Event<FRAGS.FragmentsGroup>;

  constructor(components: OBC.Components){
    super(components);
    components.add(RVTLoader.uuid, this);
    this.onProcessingFinished = new OBC.Event();
  }

  

  authorize = ()=>{
    const redirect = window.location.origin; //just getting the url with main domain and port
    const authUrl = `https://developer.api.autodesk.com/authentication/v2/authorize?response_type=code&client_id=${this.clientID}&redirect_uri=${redirect}&scope=data:read%20data:write`;
    window.location.href = authUrl;
  }

  getQuerryParameters = (parameter : requestedParameter) : string | null =>{
    const urlParams = new URLSearchParams(window.location.search); //getting the url address from my windw
    const requestedParameter = urlParams.get(parameter);
    return requestedParameter;
  }

  async getToken(authCode: string){
    if(!(authCode && this.clientID && this.clientSecret)) return;
    const tokenUrl = `https://developer.api.autodesk.com/authentication/v2/token`;
    const authorization = `Basic ${btoa(`${this.clientID}:${this.clientSecret}`)}`;

    const body = new URLSearchParams();
    body.append("grant_type", "authorization_code");
    body.append("code", authCode);
    body.append("redirect_uri",window.location.origin);

    const response = await fetch(tokenUrl,{
      method:"POST",
      body,
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        "Authorization":authorization,
      }
      
    });

    if(!response.ok){
      console.log(await response.json());
      return;
    }
    const data = await response.json();
    this._accessToken = data.access_token;


  }

  // We need to go through a bunch of places to get the file
	// and Autodesk provides us with multiple endpoints to do so
	// First we need to get the Hub which is where the projects are located
  async fetchHubs(){
    const response = await fetch(
      "https://developer.api.autodesk.com/project/v1/hubs",{
        method:"GET",
        headers:{
          Authorization:`Bearer ${this._accessToken}`,
          "Content-Type":"application/json",
        }
      }
    );

    if(!response.ok){
      console.log(await response.json());
      return;
    }

    const hubData = await response.json();
    // The reference for our hub is located in this concatenation of keys.
		// And this is actually a URL that we are going to use to get the projects
    const hubRef = hubData.data[0].relationships.projects.links.related.href; //the reponse is complex. we get a lists of all hubs. here we get project related with that hub with index 0 (assume we have one hub). we recive url of this project
    if(!hubRef) return;
    return hubRef; //returning the url og Get method from api the get all project in this hub

  }

  async fetchProjects(hubRef: string){
    // Here we can now use the reference to the hub and we 
	  // will get a response with the projects
    const response = await fetch(hubRef,{
      headers:{
        Authorization:`Bearer ${this._accessToken}`,
        "Content-Type":"application/json"
      }
    });

    if(!response.ok){
      console.log(await response.json());
      return;
    }
    const projects = await response.json();
    // Once we get the response, we need to go through the keys again
    // And this time add the content by the end of the string
    const projectRef = `${projects.data[0].relationships.rootFolder.meta.link.href}/contents`;
    return projectRef;
  }

  async fetchResource(projectRef:string){
    if(!projectRef) return;

    // With the URL reference to the project, we can add some filters to get
		// an specific folder which is the project files folder where our models are located
    const filterParameters = "?filter%5Battributes.name%5D=Project%20Files";
    const filterRef = `${projectRef}${filterParameters}`;

    const response = await fetch(filterRef, {
      headers:{
        Authorization:`Bearer ${this._accessToken}`,
        "Content-Type": "application/json",
      }
    });

    if(!response.ok){
      console.warn(await response.json());
      return;
    }

    const resources = await response.json();
    // And once again, get the reference from the keys.
    const resourceRef =
      resources.data[0].relationships.contents.links.related.href;

    return resourceRef;
  }

  async fetchFileId(resourceRef:string){

    if(!resourceRef) return;

    const response = await fetch(resourceRef,{
      headers:{
        Authorization: `Bearer ${this._accessToken}`,
        "Content-Type": "application/json",
      }
    });

    if(!response.ok){
      console.warn(await response.json());
      return;
    }

    // The response from the fetch, gives us a list of all the contents
		// in it... it's just a matter of filtering through to find our file.
    const files = await response.json();
    const filtered = files.included.filter((file:any)=>
      file.attributes.name.endsWith("burj al arab.rvt"),
    );

    // And again, we need to go through the keys to find the id
    const fileId = filtered[0].relationships.storage.data.id;
    return fileId;
  }

  // This translation job is a request we make to have the revit file be converted into
	// multiple output formats, including IFC
  async startTransitionJob(urn:string){

    // To start the job, we need to build the body of the request
	  // It includes the urn which is the id of the file we got in the previous method
	  // In the output formats we will request for the ifc type.
    const body = JSON.stringify({
      input:{
        urn: btoa(urn),
      },
      output:{
        formats:[
          {
            type:"ifc"
          }
        ]
      }
    });

    const response = await fetch(
      `https://developer.api.autodesk.com/modelderivative/v2/designdata/job`,{
        method:"POST",
        headers:{
          "Content-Type": "application/json",
          Authorization: `Bearer ${this._accessToken}`
        },
        body
      }
    );

    // We then need to check on the result to know if the job was successfully created.
    const jobResponse = await response.json();
    if(jobResponse.result ==="created" || jobResponse.result==="success"){
      console.log(jobResponse);
    }
    // And we get an id of the job that we will need later to check
	  // on the manifest and its progress
    return jobResponse.urn;
  }

  async checkManifest(manifestUrn: string){
    // The conversion takes some time so we are going to use these two variables
	  // To control the verification
    let manifestResult = "inprogress";
    let fileUrn = "";
    do{
      const response = await fetch(
        `https://developer.api.autodesk.com/modelderivative/v2/designdata/${manifestUrn}/manifest`,{
          method:"GET",
          headers:{
            Authorization: `Bearer ${this._accessToken}`,
          }
        }
      );

      // Here we get both the result and file urn
      const manifestResponse = await response.json();
      manifestResult = manifestResponse.progress;
      console.log("Manifest response: ", manifestResponse);
      fileUrn = manifestResponse.derivatives[0].children[0].urn;
      setTimeout(()=>{}, 2000);

    }while(manifestResult !== "complete");
    // Once its completed, we can return the id of the resulting file
		// or transformed file
    return fileUrn;
  }

  // With the id of the job and the id of the resulting file
	// We can go on and get the URL to download its content
	// These endpoints can only be done in the backend
	// Because we need to retrieve three signed cookies
	// Required to get the file. That is why we use Netlify
  async getFileResource(jobUrn: string, fileUrn: string){
    const body = JSON.stringify({
      jobUrn,
      fileUrn,
      accessToken: this._accessToken
    });

    const response = await fetch("/.netlify/functions/getFile",{
      method:"post",
      body
    });
    const responseData = await response.json();
    return responseData;
  }

  // Once the cookies are retrieved we can then download the content of the file
  async getFileContent(fileResource: FileResource){
    const ifcLoader = this.components.get(OBC.IfcLoader);

    const response = await fetch("/.netlify/functions/getFileData",{
      method:"post",
      headers:{
        "content-type": "application/json",
      },
      body: JSON.stringify(fileResource)
    });

    const file = await response.arrayBuffer();
    const array = new Uint8Array(file);
    const model = await ifcLoader.load(array);

    this.onProcessingFinished.trigger(model);
  }

  // And this will call the whole process to get the file
	// and start the transformation job
  async searchResource() {

    const hubRef= await this.fetchHubs();
    if(!hubRef) return;

    const projectsRef = await this.fetchProjects(hubRef);
    if(!projectsRef) return;

    const resourceRef = await this.fetchResource(projectsRef);
    if(!resourceRef) return;

    const fileId = await this.fetchFileId(resourceRef);
    if(!fileId) return;

    const jobUrn = await this.startTransitionJob(fileId);
    if(!jobUrn){
      console.warn("Could not start job transition");
      return;
    }

    const fileUrn = await this.checkManifest(jobUrn);
    if(!fileUrn){
      console.warn("File urn could not be obtained");
      return;
    }

    const fileResource : FileResource = await this.getFileResource(jobUrn, fileUrn);
    if(!fileResource) return;
    await this.getFileContent(fileResource);
  }
}

export * from "./src"