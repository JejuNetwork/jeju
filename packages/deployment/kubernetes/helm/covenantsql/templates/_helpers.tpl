{{/*
Expand the name of the chart.
*/}}
{{- define "covenantsql.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "covenantsql.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "covenantsql.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "covenantsql.labels" -}}
helm.sh/chart: {{ include "covenantsql.chart" . }}
{{ include "covenantsql.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "covenantsql.selectorLabels" -}}
app.kubernetes.io/name: {{ include "covenantsql.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Block Producer labels
*/}}
{{- define "covenantsql.bpLabels" -}}
{{ include "covenantsql.labels" . }}
app.kubernetes.io/component: block-producer
{{- end }}

{{/*
Block Producer selector labels
*/}}
{{- define "covenantsql.bpSelectorLabels" -}}
{{ include "covenantsql.selectorLabels" . }}
app.kubernetes.io/component: block-producer
{{- end }}

{{/*
Miner labels
*/}}
{{- define "covenantsql.minerLabels" -}}
{{ include "covenantsql.labels" . }}
app.kubernetes.io/component: miner
{{- end }}

{{/*
Miner selector labels
*/}}
{{- define "covenantsql.minerSelectorLabels" -}}
{{ include "covenantsql.selectorLabels" . }}
app.kubernetes.io/component: miner
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "covenantsql.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "covenantsql.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
