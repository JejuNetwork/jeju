import { ArrowLeft, Briefcase, Globe, MapPin, Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button, PageHeader } from '../../components/shared'
import { api, extractData } from '../../lib/client'

export function JobCreatePage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()

  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<
    'full-time' | 'part-time' | 'contract' | 'bounty'
  >('full-time')
  const [remote, setRemote] = useState(false)
  const [location, setLocation] = useState('')
  const [salaryMin, setSalaryMin] = useState('')
  const [salaryMax, setSalaryMax] = useState('')
  const [salaryCurrency, setSalaryCurrency] = useState('USD')
  const [skills, setSkills] = useState<string[]>([])
  const [skillInput, setSkillInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const addSkill = useCallback(() => {
    const skill = skillInput.trim()
    if (skill && !skills.includes(skill)) {
      setSkills((prev) => [...prev, skill])
      setSkillInput('')
    }
  }, [skillInput, skills])

  const removeSkill = useCallback((skill: string) => {
    setSkills((prev) => prev.filter((s) => s !== skill))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!isConnected) {
      toast.error('Please connect your wallet to post a job')
      return
    }

    setIsSubmitting(true)

    const response = await api.api.jobs.post({
      title,
      company,
      description,
      type,
      remote,
      location: remote && !location ? 'Remote' : location,
      salary:
        salaryMin && salaryMax
          ? {
              min: Number.parseInt(salaryMin, 10),
              max: Number.parseInt(salaryMax, 10),
              currency: salaryCurrency,
              period: 'year',
            }
          : undefined,
      skills,
      poster: address as string,
    })

    setIsSubmitting(false)

    const data = extractData(response)
    if (data && 'id' in data) {
      toast.success('Job posted successfully')
      navigate(`/jobs/${data.id}`)
    }
  }

  return (
    <div className="page-container">
      <Link
        to="/jobs"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Jobs
      </Link>

      <PageHeader
        title="Post a Job"
        icon={Briefcase}
        iconColor="text-info-400"
      />

      <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
        {/* Basic Info */}
        <div className="card p-6 space-y-4 animate-in">
          <h3 className="font-semibold text-surface-100 mb-4">Job Details</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="title"
                className="block text-sm font-medium text-surface-300 mb-2"
              >
                Job Title
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Senior Solidity Developer"
                className="input w-full"
                required
              />
            </div>

            <div>
              <label
                htmlFor="company"
                className="block text-sm font-medium text-surface-300 mb-2"
              >
                Company Name
              </label>
              <input
                id="company"
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Your company name"
                className="input w-full"
                required
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-surface-300 mb-2"
            >
              Job Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the role, responsibilities, and requirements..."
              className="input w-full min-h-[150px] resize-y"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="type"
                className="block text-sm font-medium text-surface-300 mb-2"
              >
                Job Type
              </label>
              <select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className="input w-full"
              >
                <option value="full-time">Full-time</option>
                <option value="part-time">Part-time</option>
                <option value="contract">Contract</option>
                <option value="bounty">Bounty</option>
              </select>
            </div>

            <fieldset>
              <legend className="block text-sm font-medium text-surface-300 mb-2">
                Work Location
              </legend>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRemote(false)}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    !remote
                      ? 'bg-factory-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                  }`}
                >
                  <MapPin className="w-4 h-4 inline mr-1" />
                  On-site
                </button>
                <button
                  type="button"
                  onClick={() => setRemote(true)}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    remote
                      ? 'bg-accent-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                  }`}
                >
                  <Globe className="w-4 h-4 inline mr-1" />
                  Remote
                </button>
              </div>
            </fieldset>
          </div>

          {!remote && (
            <div>
              <label
                htmlFor="location"
                className="block text-sm font-medium text-surface-300 mb-2"
              >
                Location
              </label>
              <input
                id="location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g., San Francisco, CA"
                className="input w-full"
                required={!remote}
              />
            </div>
          )}
        </div>

        {/* Salary */}
        <div
          className="card p-6 space-y-4 animate-in"
          style={{ animationDelay: '50ms' }}
        >
          <h3 className="font-semibold text-surface-100 mb-4">
            Compensation (Optional)
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="salaryMin"
                className="block text-sm font-medium text-surface-300 mb-2"
              >
                Min Salary
              </label>
              <input
                id="salaryMin"
                type="number"
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
                placeholder="80000"
                className="input w-full"
              />
            </div>

            <div>
              <label
                htmlFor="salaryMax"
                className="block text-sm font-medium text-surface-300 mb-2"
              >
                Max Salary
              </label>
              <input
                id="salaryMax"
                type="number"
                value={salaryMax}
                onChange={(e) => setSalaryMax(e.target.value)}
                placeholder="120000"
                className="input w-full"
              />
            </div>

            <div>
              <label
                htmlFor="salaryCurrency"
                className="block text-sm font-medium text-surface-300 mb-2"
              >
                Currency
              </label>
              <select
                id="salaryCurrency"
                value={salaryCurrency}
                onChange={(e) => setSalaryCurrency(e.target.value)}
                className="input w-full"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="ETH">ETH</option>
              </select>
            </div>
          </div>
        </div>

        {/* Skills */}
        <div
          className="card p-6 animate-in"
          style={{ animationDelay: '100ms' }}
        >
          <h3 className="font-semibold text-surface-100 mb-4">
            Required Skills
          </h3>

          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSkill()
                }
              }}
              placeholder="Add a skill (e.g., Solidity, React)"
              className="input flex-1"
            />
            <Button type="button" variant="secondary" onClick={addSkill}>
              <Plus className="w-4 h-4" />
              Add
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span
                key={skill}
                className="badge badge-info flex items-center gap-1.5"
              >
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  className="hover:text-error-400 transition-colors"
                >
                  ×
                </button>
              </span>
            ))}
            {skills.length === 0 && (
              <span className="text-sm text-surface-500">
                No skills added yet
              </span>
            )}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-4">
          <Link
            to="/jobs"
            className="btn bg-surface-800 text-surface-300 hover:bg-surface-700"
          >
            Cancel
          </Link>
          <Button
            type="submit"
            variant="primary"
            loading={isSubmitting}
            disabled={!isConnected}
          >
            {!isConnected ? 'Connect Wallet' : 'Post Job'}
          </Button>
        </div>
      </form>
    </div>
  )
}
