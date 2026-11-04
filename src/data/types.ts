export type KittiCalibration={p:number[];r:number[];t:number[]};
export type Frame={time:number;cameraTime?:number;points?:Float32Array;url?:string;file?:File;imageFile?:File;imageUrl?:string;calibration?:KittiCalibration;pose?:number[];name:string};
