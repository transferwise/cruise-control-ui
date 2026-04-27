<!-- Copyright 2017-2019 LinkedIn Corp. Licensed under the BSD 2-Clause License (the "License"). See License in the project root for license information. -->
<template>
  <div v-if='state'>
    <button class="btn btn-primary" @click='changeState()'>{{ newState }}</button>
    <exception v-if='error' :exception='errorData'></exception>
    <div v-if='success === true' class="alert alert-success">
      Successfully Submitted Request.
    </div>
  </div>
  <div v-else class="alert alert-info">
    Please wait while the current state is being updated.
  </div>
</template>

<script>

export default {
  name: 'AdminSampling',
  props: {
    'group': String,
    'cluster': String
  },
  data () {
    return {
      error: false,
      errorData: null,
      async: false,
      asyncData: null,
      asyncRetryTimer: null,
      success: null,
      state: ''
    }
  },
  created () {
    this.argsChanged()
  },
  beforeDestroy () {
    if (this.asyncRetryTimer) {
      clearTimeout(this.asyncRetryTimer)
    }
  },
  watch: {
    group: function (ogroup, ngroup) {
      this.argsChanged()
    },
    cluster: function (ocluster, ncluster) {
      this.argsChanged()
    }
  },
  computed: {
    monitor_url () {
      return this.$helpers.getURL('state', {substates: 'monitor'})
    },
    url () {
      if (this.state === 'PAUSED') {
        return this.$helpers.getURL('resume_sampling')
      } else {
        return this.$helpers.getURL('pause_sampling')
      }
    },
    newState () {
      if (this.state === 'PAUSED') {
        return 'Resume Sampling'
      } else {
        return 'Pause Sampling'
      }
    }
  },
  methods: {
    argsChanged (retries) {
      retries = retries || 0
      const newurl = this.$store.getters.getnewurl(this.group, this.cluster)
      if (!newurl) {
        if (retries < 20) {
          setTimeout(() => this.argsChanged(retries + 1), 500)
        }
        return
      }
      this.$store.commit('seturl', newurl)
      this.loaded = false
      if (this.asyncRetryTimer) {
        clearTimeout(this.asyncRetryTimer)
        this.asyncRetryTimer = null
      }
      this.fetchMonitorState()
    },
    fetchMonitorState () {
      const vm = this
      vm.loading = true
      window.fetch(vm.monitor_url, {credentials: 'omit'}).then((resp) => {
        const contentType = resp.headers.get('content-type') || ''
        return resp.text().then((text) => ({text, contentType, ok: resp.ok, status: resp.status}))
      }).then((resp) => {
        let data
        try { data = JSON.parse(resp.text) } catch (e) { data = resp.text }
        if (data === null || data === undefined || data === '') {
          vm.error = true
          vm.errorData = 'CruiseControl sent an empty response with ' + resp.status + ' status code.'
        } else if (resp.contentType.match(/text\/plain/) || (data && data.progress)) {
          vm.async = true
          vm.asyncData = data
          if (vm.asyncRetryTimer) clearTimeout(vm.asyncRetryTimer)
          vm.asyncRetryTimer = setTimeout(() => vm.fetchMonitorState(), 5000)
        } else if (!resp.ok) {
          if (vm.asyncRetryTimer) { clearTimeout(vm.asyncRetryTimer); vm.asyncRetryTimer = null }
          vm.loading = false
          vm.error = true
          vm.errorData = data
        } else {
          if (vm.asyncRetryTimer) { clearTimeout(vm.asyncRetryTimer); vm.asyncRetryTimer = null }
          vm.async = false
          vm.error = false
          vm.errorData = null
          vm.loading = false
          vm.state = data.MonitorState
          vm.loaded = true
        }
      }).catch((e) => {
        if (vm.asyncRetryTimer) { clearTimeout(vm.asyncRetryTimer); vm.asyncRetryTimer = null }
        vm.loading = false
        vm.error = true
        vm.errorData = e.message || e
      })
    },
    changeState () {
      let vm = this
      this.$http.post(vm.url, {withCredentials: true}).then((r) => {
        vm.success = true
        window.setTimeout(function () {
          vm.success = null
          vm.state = null
        }, 3000)
      }, (e) => {
        vm.error = true
        vm.errorData = e && e.response && e.response.data ? e.response.data : e
      })
    }
  }
}
</script>
