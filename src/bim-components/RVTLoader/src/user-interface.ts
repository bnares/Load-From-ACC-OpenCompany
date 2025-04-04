import * as BUI from "@thatopen/ui"
import * as OBC from "@thatopen/components"
import { RVTLoader } from ".."

export function RvtUI(components: OBC.Components){
  const rvtLoader = components.get(RVTLoader);

  const onLoadFileClick = async (e:any)=>{
    const btn = e.target;

    btn.loading = true;
    await rvtLoader.searchResource();
    btn.loading = false;
  }

  return BUI.html`
     <bim-toolbar-section label="Revit Loader" icon="">
    <bim-button label="Authorize" @click=${() =>
      rvtLoader.authorize()}></bim-button>
    <bim-button label="Load File" @click=${onLoadFileClick}></bim-button>
  </bim-toolbar-section>
  `
}