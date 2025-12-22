'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useRouter } from 'next/navigation';
import { 
  Brain, 
  Upload,
  FileUp,
  Globe,
  Lock,
  Info,
  CheckCircle,
  Loader2,
  Link as LinkIcon,
  Shield
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';

type ModelType = 'LLM' | 'VISION' | 'AUDIO' | 'EMBEDDING' | 'MULTIMODAL' | 'OTHER';
type License = 'MIT' | 'APACHE2' | 'GPL3' | 'LLAMA2' | 'CC_BY_NC' | 'CUSTOM';
type AccessLevel = 'PUBLIC' | 'RESTRICTED' | 'PRIVATE';

const modelTypes: { value: ModelType; label: string; description: string }[] = [
  { value: 'LLM', label: 'Large Language Model', description: 'Text generation, chat, code' },
  { value: 'VISION', label: 'Vision', description: 'Image classification, detection, segmentation' },
  { value: 'AUDIO', label: 'Audio', description: 'Speech recognition, synthesis, music' },
  { value: 'EMBEDDING', label: 'Embedding', description: 'Text/image embeddings for search' },
  { value: 'MULTIMODAL', label: 'Multimodal', description: 'Multiple input/output types' },
  { value: 'OTHER', label: 'Other', description: 'Custom model types' },
];

const licenses: { value: License; label: string; commercial: boolean }[] = [
  { value: 'MIT', label: 'MIT License', commercial: true },
  { value: 'APACHE2', label: 'Apache 2.0', commercial: true },
  { value: 'GPL3', label: 'GPL v3', commercial: false },
  { value: 'LLAMA2', label: 'LLaMA 2 Community', commercial: true },
  { value: 'CC_BY_NC', label: 'CC BY-NC 4.0', commercial: false },
  { value: 'CUSTOM', label: 'Custom License', commercial: false },
];

export default function UploadModelPage() {
  const { isConnected: _isConnected, address: _address } = useAccount();
  const router = useRouter();
  
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form state
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [description, setDescription] = useState('');
  const [modelType, setModelType] = useState<ModelType>('LLM');
  const [license, setLicense] = useState<License>('MIT');
  const [customLicenseUri, setCustomLicenseUri] = useState('');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('PUBLIC');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  
  // Files
  const [modelFile, setModelFile] = useState<File | null>(null);
  // const [configFile, setConfigFile] = useState<File | null>(null);
  
  // Training provenance
  const [trainingDataUri, setTrainingDataUri] = useState('');
  const [baseModel, setBaseModel] = useState('');
  const [trainingJobId, setTrainingJobId] = useState('');

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    
    // Simulate upload
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setIsSubmitting(false);
    router.push('/models');
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/models" className="text-factory-400 hover:text-factory-300 text-sm mb-4 inline-block">
            ← Back to Model Hub
          </Link>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Brain className="w-7 h-7 text-amber-400" />
            Upload Model
          </h1>
          <p className="text-factory-400 mt-1">Share your model with the Jeju community</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-4 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center flex-1">
              <div className={clsx(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                step >= s ? 'bg-accent-600 text-white' : 'bg-factory-800 text-factory-500'
              )}>
                {step > s ? <CheckCircle className="w-5 h-5" /> : s}
              </div>
              {s < 3 && (
                <div className={clsx(
                  'flex-1 h-1 mx-2',
                  step > s ? 'bg-accent-600' : 'bg-factory-800'
                )} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Basic Info */}
        {step === 1 && (
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-factory-100 mb-6">Basic Information</h2>
            
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">
                    Organization
                  </label>
                  <input
                    type="text"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    placeholder="your-org"
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-factory-300 mb-2">
                    Model Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-awesome-model"
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-factory-300 mb-2">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what your model does, its capabilities, and use cases..."
                  rows={4}
                  className="input resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-factory-300 mb-2">
                  Model Type
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {modelTypes.map((type) => (
                    <button
                      key={type.value}
                      onClick={() => setModelType(type.value)}
                      className={clsx(
                        'p-3 rounded-lg border text-left transition-colors',
                        modelType === type.value
                          ? 'border-accent-500 bg-accent-500/10'
                          : 'border-factory-700 hover:border-factory-600'
                      )}
                    >
                      <p className="font-medium text-factory-200">{type.label}</p>
                      <p className="text-xs text-factory-500">{type.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-factory-300 mb-2">
                  Tags
                </label>
                <div className="flex gap-2 mb-2 flex-wrap">
                  {tags.map((tag) => (
                    <span key={tag} className="badge badge-info flex items-center gap-1">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="hover:text-white">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addTag()}
                    placeholder="Add tag..."
                    className="input flex-1"
                  />
                  <button onClick={addTag} className="btn btn-secondary">
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end mt-6">
              <button 
                onClick={() => setStep(2)}
                disabled={!name || !organization}
                className="btn btn-primary"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: License & Access */}
        {step === 2 && (
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-factory-100 mb-6">License & Access</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-factory-300 mb-2">
                  License
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {licenses.map((lic) => (
                    <button
                      key={lic.value}
                      onClick={() => setLicense(lic.value)}
                      className={clsx(
                        'p-3 rounded-lg border text-left transition-colors',
                        license === lic.value
                          ? 'border-accent-500 bg-accent-500/10'
                          : 'border-factory-700 hover:border-factory-600'
                      )}
                    >
                      <p className="font-medium text-factory-200">{lic.label}</p>
                      <p className={clsx('text-xs', lic.commercial ? 'text-green-400' : 'text-amber-400')}>
                        {lic.commercial ? 'Commercial use allowed' : 'Non-commercial only'}
                      </p>
                    </button>
                  ))}
                </div>
                {license === 'CUSTOM' && (
                  <div className="mt-3">
                    <input
                      type="text"
                      value={customLicenseUri}
                      onChange={(e) => setCustomLicenseUri(e.target.value)}
                      placeholder="IPFS URI for custom license..."
                      className="input"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-factory-300 mb-2">
                  Access Level
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'PUBLIC' as const, label: 'Public', icon: Globe, desc: 'Anyone can download' },
                    { value: 'RESTRICTED' as const, label: 'Restricted', icon: Shield, desc: 'Approval required' },
                    { value: 'PRIVATE' as const, label: 'Private', icon: Lock, desc: 'Only you' },
                  ].map((access) => (
                    <button
                      key={access.value}
                      onClick={() => setAccessLevel(access.value)}
                      className={clsx(
                        'p-3 rounded-lg border text-left transition-colors',
                        accessLevel === access.value
                          ? 'border-accent-500 bg-accent-500/10'
                          : 'border-factory-700 hover:border-factory-600'
                      )}
                    >
                      <access.icon className="w-5 h-5 mb-2 text-factory-400" />
                      <p className="font-medium text-factory-200">{access.label}</p>
                      <p className="text-xs text-factory-500">{access.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-factory-800/50 rounded-lg border border-factory-700">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-factory-300 font-medium">On-chain Provenance</p>
                    <p className="text-xs text-factory-500 mt-1">
                      Your model metadata, license, and access controls will be recorded on-chain 
                      for transparent provenance tracking. Model files are stored on IPFS.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between mt-6">
              <button onClick={() => setStep(1)} className="btn btn-secondary">
                Back
              </button>
              <button onClick={() => setStep(3)} className="btn btn-primary">
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Upload & Training Provenance */}
        {step === 3 && (
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-factory-100 mb-6">Upload & Provenance</h2>
            
            <div className="space-y-6">
              {/* File Upload */}
              <div>
                <label className="block text-sm font-medium text-factory-300 mb-2">
                  Model Files
                </label>
                <div className="border-2 border-dashed border-factory-700 rounded-lg p-8 text-center hover:border-factory-600 transition-colors">
                  <FileUp className="w-12 h-12 mx-auto mb-4 text-factory-500" />
                  <p className="text-factory-300 mb-2">
                    Drag & drop your model files here, or click to browse
                  </p>
                  <p className="text-factory-500 text-sm mb-4">
                    Supports .safetensors, .gguf, .onnx, .pt, .bin (max 50GB)
                  </p>
                  <input
                    type="file"
                    onChange={(e) => setModelFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="model-upload"
                    accept=".safetensors,.gguf,.onnx,.pt,.bin"
                  />
                  <label htmlFor="model-upload" className="btn btn-secondary cursor-pointer">
                    Select Files
                  </label>
                  {modelFile && (
                    <p className="mt-4 text-green-400 text-sm">
                      ✓ {modelFile.name}
                    </p>
                  )}
                </div>
              </div>

              {/* Training Provenance */}
              <div className="border-t border-factory-800 pt-6">
                <h3 className="text-md font-medium text-factory-200 mb-4 flex items-center gap-2">
                  <LinkIcon className="w-4 h-4" />
                  Training Provenance (Optional)
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-factory-400 mb-2">
                      Base Model (if fine-tuned)
                    </label>
                    <input
                      type="text"
                      value={baseModel}
                      onChange={(e) => setBaseModel(e.target.value)}
                      placeholder="e.g., jeju/llama-3-8b or meta-llama/Llama-2-7b"
                      className="input"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm text-factory-400 mb-2">
                      Training Data URI (IPFS)
                    </label>
                    <input
                      type="text"
                      value={trainingDataUri}
                      onChange={(e) => setTrainingDataUri(e.target.value)}
                      placeholder="ipfs://..."
                      className="input"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm text-factory-400 mb-2">
                      Psyche Training Job ID (if trained via Jeju)
                    </label>
                    <input
                      type="text"
                      value={trainingJobId}
                      onChange={(e) => setTrainingJobId(e.target.value)}
                      placeholder="0x..."
                      className="input"
                    />
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div className="p-4 bg-factory-800/50 rounded-lg">
                <h4 className="text-sm font-medium text-factory-300 mb-3">Summary</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-factory-500">Model:</span>{' '}
                    <span className="text-factory-200">{organization}/{name}</span>
                  </div>
                  <div>
                    <span className="text-factory-500">Type:</span>{' '}
                    <span className="text-factory-200">{modelType}</span>
                  </div>
                  <div>
                    <span className="text-factory-500">License:</span>{' '}
                    <span className="text-factory-200">{license}</span>
                  </div>
                  <div>
                    <span className="text-factory-500">Access:</span>{' '}
                    <span className="text-factory-200">{accessLevel}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between mt-6">
              <button onClick={() => setStep(2)} className="btn btn-secondary">
                Back
              </button>
              <button 
                onClick={handleSubmit}
                disabled={isSubmitting || !modelFile}
                className="btn btn-primary"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload Model
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

